import * as XLSX from "xlsx";
import type { Glossary } from "./glossary";
import type { SnapshotValue } from "./snapshot";

/**
 * 公式驱动的业务口径 Excel（业务专家编辑界面）。
 *
 * Excel 机制即实现：
 *  - 字段标注 sheet：数据区（权威文档 + evaluate 拉取的数据快照列 V），只读锁定
 *  - 业务术语 sheet：值列 = 真实 SUMIF/MAXIFS 公式（聚合语义用 Excel 原生函数表达）
 *      sum            → =SUMIF(字段标注!C:C, 术语名, 字段标注!V:V)
 *      sum_of         → 多个 SUMIF 相加（组成关系）
 *      weighted_ratio → 分子 SUMIF / 分母 SUMIF（派生关系）
 *      ratio 配置值    → =MAXIFS(...)（多品线取最严口径，与 SQL evaluate 的 MAX 一致）
 *  - 业务规则 sheet：表达式列可编辑（业务专家写 {术语} 文本），生成公式列只读
 *  - 公式计算结果 sheet：=业务规则!B2 引用，Excel 打开自动重算
 *  - 业务动作 sheet：可编辑（业务专家改动作参数），触发状态列 = IF 公式
 *
 * 双向映射：export-excel 生成（JSON→Excel）；import-excel 读回可编辑列（Excel→JSON）。
 * 只读层 ws["!protect"] + 全 locked；可编辑单元格 unlocked。
 */

export interface EvalResult {
  excel: string;
  sql: string;
  result: string;
  at: string;
}

const LOCKED = { locked: true };
const EDITABLE = { locked: false };
/** 术语值公式（Excel 原生函数表达聚合语义） */
function termFormula(g: Glossary, termName: string): string {
  const term = g.listTerms().find((t) => t.name === termName);
  if (!term) return "";
  // 字段标注列序: A数据库 B表 C字段 D权威中文名 E释义 F标注来源 G单位 H当前值
  // SUMIF/MAXIFS 按 D 列（权威中文名）匹配，H 列（当前值）求和
  const sumif = (fieldTerm: string) =>
    `SUMIF('字段标注'!$D:$D,"${fieldTerm}",'字段标注'!$H:$H)`;
  const maxif = (fieldTerm: string) =>
    `MAXIFS('字段标注'!$H:$H,'字段标注'!$D:$D,"${fieldTerm}")`;
  switch (term.aggregation.kind) {
    case "weighted_ratio": {
      const num = term.aggregation.numerator.map(sumif).join("+");
      const den = term.aggregation.denominator.map(sumif).join("+");
      return `=IF(${den}=0,0,(${num})/(${den}))`;
    }
    case "sum_of":
      return `=${term.aggregation.parts.map(sumif).join("+")}`;
    case "diff_of": {
      const [first, ...rest] = term.aggregation.parts.map(sumif);
      return `=(${first})-(${rest.join(")-(")})`;
    }
    case "sum":
      return `=${sumif(termName)}`;
    case "avg":
      return `=IF(${sumif(termName)}=0,0,${sumif(termName)}/COUNTIF('字段标注'!$D:$D,"${termName}"))`;
    case "count":
      return `=COUNTIF('字段标注'!$D:$D,"${termName}")`;
    case "ratio":
      // 配置值（如品线基线）：多行取最大 = 最严口径，与 SQL evaluate 的 MAX() 一致
      return `=${maxif(termName)}`;
  }
}

export function renderWorkbook(
  g: Glossary,
  results?: Record<string, EvalResult>,
  snapshot?: SnapshotValue[],
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const snapMap = new Map(snapshot?.map((s) => [`${s.table}.${s.column}`, s.value]));

  // ── Sheet 1: 字段标注（只读锁定；V 列为 evaluate 拉取的数据快照）──
  const fieldRows = g.listTables().flatMap((t) =>
    g
      .listFields()
      .filter((f) => f.table === t.name)
      .map((f) => ({
        数据库: t.database ?? "",
        表: f.table,
        字段: f.column,
        权威中文名: f.term,
        释义: f.note ?? "",
        标注来源: f.annotated_by,
        单位: f.unit ?? "",
        当前值: (snapMap.get(`${f.table}.${f.column}`) as number | undefined) ?? undefined,
      })),
  );
  const wsFields = XLSX.utils.json_to_sheet(fieldRows, { header: ["数据库", "表", "字段", "权威中文名", "释义", "标注来源", "单位", "当前值"] });
  wsFields["!cols"] = [{ wch: 14 }, { wch: 26 }, { wch: 46 }, { wch: 18 }, { wch: 60 }, { wch: 30 }, { wch: 8 }, { wch: 14 }];
  // 全部锁定（只读层）
  for (const key of Object.keys(wsFields)) {
    if (!key.startsWith("!")) wsFields[key].s = LOCKED;
  }
  wsFields["!protect"] = { selectLockedCells: true };
  wsFields["!autofilter"] = { ref: `A1:H${fieldRows.length + 1}` };
  XLSX.utils.book_append_sheet(wb, wsFields, "字段标注");

  // ── Sheet 2: 业务术语（只读锁定；值列 = 真实 Excel 公式）──
  const termRows = g.listTerms().map((t) => ({
    术语名: t.name,
    值: termFormula(g, t.name).replace(/^=/, ""), // 公式（写入时无 =，SheetJS f 规范）
    定义: t.definition,
    聚合语义: JSON.stringify(t.aggregation),
    粒度: t.grain,
    版本: t.version,
  }));
  const wsTerms = XLSX.utils.json_to_sheet(termRows, { header: ["术语名", "值", "定义", "聚合语义", "粒度", "版本"] });
  // 值列（B）改写成真公式 cell（json_to_sheet 会字符串化，需手动 { t:'n', f }）
  for (let i = 0; i < termRows.length; i++) {
    const formula = termFormula(g, termRows[i].术语名);
    wsTerms[XLSX.utils.encode_cell({ r: i + 1, c: 1 })] = {
      t: "n",
      f: formula.replace(/^=/, ""),
      v: 0, // 缓存值（SheetJS 写入公式 cell 需要 v，Excel/HF 打开后重算）
      s: LOCKED,
    };
  }
  wsTerms["!cols"] = [{ wch: 18 }, { wch: 60 }, { wch: 45 }, { wch: 50 }, { wch: 12 }, { wch: 8 }];
  // 术语名/定义/聚合 列锁定；值列是公式（也锁定，防手改公式）
  for (const key of Object.keys(wsTerms)) {
    if (!key.startsWith("!")) wsTerms[key].s = LOCKED;
  }
  wsTerms["!protect"] = { selectLockedCells: true };
  XLSX.utils.book_append_sheet(wb, wsTerms, "业务术语");

  // ── Sheet 3: 业务规则（表达式列可编辑 → 写回 JSON）──
  const ruleRows = g.listRules().map((r) => ({
    规则名: r.name,
    表达式: r.expression, // 可编辑：业务专家用 {术语} 写
    生成公式: (() => {
      try {
        return g.expand(r.name, "excel");
      } catch {
        return "（展开失败：引用缺失）";
      }
    })(),
    负责人: r.owner,
    版本: r.version ?? "",
    引用链: (() => {
      try {
        return g
          .trace(r.name)
          .legs.map((l) => l.term + "→" + l.fields.map((f) => `${f.table}.${f.column}`).join(","))
          .join("；");
      } catch {
        return "";
      }
    })(),
  }));
  const wsRules = XLSX.utils.json_to_sheet(ruleRows, { header: ["规则名", "表达式", "生成公式", "负责人", "版本", "引用链"] });
  wsRules["!cols"] = [{ wch: 14 }, { wch: 55 }, { wch: 90 }, { wch: 18 }, { wch: 8 }, { wch: 60 }];
  for (const key of Object.keys(wsRules)) {
    if (!key.startsWith("!")) {
      const cell = wsRules[key];
      const col = key.replace(/[0-9]/g, "");
      cell.s = col === "B" ? EDITABLE : LOCKED; // 只 B 列（表达式）可编辑
    }
  }
  wsRules["!protect"] = { selectLockedCells: true };
  XLSX.utils.book_append_sheet(wb, wsRules, "业务规则");

  // ── Sheet 4: 公式计算结果（全锁定，引用规则公式，打开自动重算）──
  const evalRows = g.listRules().map((r, i) => ({
    规则名: r.name,
    结果: `='业务规则'!B${i + 2}`,
    判定: `=IF('业务规则'!B${i + 2},"达标 ✅","不达标 ❌")`,
    对应动作: r.action?.name ?? "—",
    数据日期: results?.[r.name]?.at ?? "—",
    服务端预算: results?.[r.name]?.result ?? "—",
  }));
  const wsEval = XLSX.utils.json_to_sheet(evalRows, { header: ["规则名", "结果", "判定", "对应动作", "数据日期", "服务端预算"] });
  wsEval["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }];
  // 结果（B）/判定（C）列改写成真公式 cell——引用业务术语 sheet 的值（SUMIF 计算列）
  // 规则表达式 {术语} → 业务术语!B{行号}，IF(a>b,TRUE,FALSE) 保持
  const termRowOf = (name: string): number => {
    const idx = g.listTerms().findIndex((t) => t.name === name);
    return idx >= 0 ? idx + 2 : 2;
  };
  for (let i = 0; i < g.listRules().length; i++) {
    const rule = g.listRules()[i];
    // 表达式语言 → Excel 公式：{术语}→术语sheet引用；"a AND b"→AND(a,b)；TRUE/FALSE→1/0
    const expr = rule.expression
      .replace(/\{([^}]+)\}/g, (_, name: string) => `'业务术语'!B${termRowOf(name)}`)
      .replace(/([^,()]+)\s+AND\s+([^,()]+)/g, "AND($1, $2)")
      .replace(/TRUE/g, "1")
      .replace(/FALSE/g, "0");
    wsEval[XLSX.utils.encode_cell({ r: i + 1, c: 1 })] = { t: "n", f: expr.replace(/^=/, ""), v: 0, s: LOCKED };
    wsEval[XLSX.utils.encode_cell({ r: i + 1, c: 2 })] = {
      t: "s",
      f: `IF('业务术语'!B${termRowOf(rule.terms[0])}>'业务术语'!B${termRowOf(rule.terms[1] ?? rule.terms[0])},"达标 ✅","不达标 ❌")`,
      v: "—",
      s: LOCKED,
    };
  }
  for (const key of Object.keys(wsEval)) {
    if (!key.startsWith("!")) wsEval[key].s = LOCKED;
  }
  wsEval["!protect"] = { selectLockedCells: true };
  XLSX.utils.book_append_sheet(wb, wsEval, "公式计算结果");

  // ── Sheet 5: 业务动作（全列可编辑 → 写回 JSON）──
  const actionRows = g.listRules().map((r) => ({
    触发规则: r.name,
    动作名: r.action?.name ?? "",
    动作类型: r.action?.type ?? "",
    触发条件: r.action?.trigger ?? "",
    动作参数: r.action?.params ? JSON.stringify(r.action.params) : "",
    执行人: r.action?.owner ?? r.owner,
    触发状态: `=IF('公式计算结果'!B${actionRowsIndex(r)}, "触发","—")`,
  }));
  function actionRowsIndex(r: { name: string }): number {
    return g.listRules().findIndex((x) => x.name === r.name) + 2;
  }
  const wsActions = XLSX.utils.json_to_sheet(actionRows, { header: ["触发规则", "动作名", "动作类型", "触发条件", "动作参数", "执行人", "触发状态"] });
  wsActions["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 60 }, { wch: 30 }, { wch: 12 }, { wch: 12 }];
  // 触发状态（G）列改写成真公式 cell
  for (let i = 0; i < g.listRules().length; i++) {
    const r = i + 2;
    wsActions[XLSX.utils.encode_cell({ r: i + 1, c: 6 })] = {
      t: "s",
      f: `IF('公式计算结果'!B${r},"触发","—")`,
      v: "—",
      s: LOCKED,
    };
  }
  for (const key of Object.keys(wsActions)) {
    if (!key.startsWith("!")) {
      const cell = wsActions[key];
      const col = key.replace(/[0-9]/g, "");
      cell.s = col === "G" ? LOCKED : EDITABLE; // G 列触发状态=公式，锁定；其余可编辑
    }
  }
  wsActions["!protect"] = { selectLockedCells: true };
  XLSX.utils.book_append_sheet(wb, wsActions, "业务动作");

  return wb;
}

/** 生成 xlsx 二进制 buffer */
export function renderWorkbookBuffer(g: Glossary): Buffer {
  const wb = renderWorkbook(g);
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
