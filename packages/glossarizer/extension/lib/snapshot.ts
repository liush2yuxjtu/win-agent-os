import { Glossary, GlossaryError } from "./glossary";

/**
 * 字段级数据快照：为字段标注 sheet 的「当前值」列（V 列）拉取真实数据。
 *
 * 每张表的取值策略：
 *  - 按日指标表（素材列表/乘方调控）：当日各数值列 SUM
 *  - 配置表（QC_MONTAGE_PRODUCT）：基线列取 MAX（最严口径，与规则 evaluate 的 MAX 一致）
 *
 * 输出 { table, column, value }[]，renderWorkbook 时按 (table, column) 填 V 列。
 */

export interface SnapshotValue {
  table: string;
  column: string;
  value: number | null;
}

/** 数值列判定：float/decimal/numeric/int 类型字段（从词典字段绑定推断，忽略已知文本列） */
const TEXT_COLS = new Set([
  "ID", "ADVERTISER_ID", "AWEME_ID", "MATERIAL_ID", "VIDEO_ID", "MATERIAL_NAME", "TASK_ID",
  "TASK_NAME", "AD_ID", "DATE_TIME", "STAT_TIME", "CREATE_TIME", "CREAT_TIME", "COLLECT_TIME",
  "CREATED", "WRITE_TIME", "BATCH_ID", "MATERIAL_SOURCE", "GLOBAL_TYPE", "CONTROL_TYPE", "CONTROL_STAT",
  "CONTROL_RESULT", "DOWNLOAD_URL", "PROD_ID", "PROD_NAME", "BRAND_ID", "STATE", "PRODUCT_CONFIG_JSON",
  "FILENAME", "V_ID", "ID_DESC", "SUB_ACCOUNT_ID", "ACCOUNT_ID", "ACCOUNT_NAME",
  // 时间/文本/配置列（datetime / nvarchar，SUM 会报错）
  "STRATEGY_ID", "CONFIG_NAME", "TAG_ID", "TAG_NAME", "LEVEL", "PARENT_ID", "DATA_ID",
  "MATERIAL_TYPE", "STAT_START_TIME", "STAT_END_TIME", "REMARK", "CONFIG_JSON", "TYPE", "NAME",
  "SHOW_NAME", "CREATE_BY", "UPDATE_TIME", "UPDATE_BY", "IS_DELETED", "DELETE_TIME",
]);

export async function fetchSnapshot(
  g: Glossary,
  runSql: (sql: string) => Promise<string | number | null>,
  date: string,
): Promise<SnapshotValue[]> {
  const out: SnapshotValue[] = [];
  // 只查术语链上的字段（业务口径真正用到的列），避免全表 44 列 SUM 拖慢
  const wanted = new Set<string>();
  for (const t of g.listTerms()) {
    const agg = t.aggregation;
    if (agg.kind === "weighted_ratio") {
      agg.numerator.forEach((x) => wanted.add(x));
      agg.denominator.forEach((x) => wanted.add(x));
    } else if (agg.kind === "sum_of" || agg.kind === "diff_of") {
      agg.parts.forEach((x) => wanted.add(x));
    } else {
      wanted.add(t.name);
    }
  }
  const byTable = new Map<string, { database: string; cols: string[] }>();
  for (const t of g.listTables()) {
    const cols = g
      .listFields()
      .filter((f) => f.table === t.name && wanted.has(f.term) && !TEXT_COLS.has(f.column))
      .map((f) => f.column);
    if (cols.length > 0) byTable.set(t.name, { database: t.database ?? "", cols });
  }

  for (const [table, { database, cols }] of byTable) {
    if (table === "QC_MONTAGE_PRODUCT") {
      // 配置表：基线列取 MAX（与规则口径一致）
      for (const col of cols) {
        const sql = `SELECT TOP 1 MAX([${col}]) AS v FROM [video_management].[dbo].[${table}] WHERE STATE = '1'`;
        const raw = await runSql(sql);
        out.push({ table, column: col, value: parseFirstValue(raw) });
      }
      continue;
    }
    // 按日指标表：当日各数值列 SUM（一次查全部列）
    const sumExpr = cols.map((c) => `SUM([${c}]) AS [${c}]`).join(", ");
    const dateCol = table === "千川素材数据_乘方_调控" ? "DATE_TIME" : "STAT_TIME";
    const sql = `SELECT TOP 1 ${sumExpr} FROM [${database}].[dbo].[${table}] WHERE [${dateCol}] = '${date}'`;
    const row = await runSql(sql);
    if (typeof row === "string" && row.includes("|")) {
      // 对齐文本表格：表头 / --- / 数据行
      const lines = row.split("\n").map((l) => l.trim()).filter(Boolean);
      const header = lines[0]?.split("|").map((s) => s.trim().replace(/^\[|\]$/g, "")) ?? [];
      const dataLine = lines.find((l) => !l.startsWith("---") && !/^\(.*行.*\)$/.test(l) && l !== lines[0]);
      const vals = dataLine?.split("|").map((s) => s.trim()) ?? [];
      cols.forEach((c, i) => {
        const idx = header.indexOf(c);
        const raw = idx >= 0 ? vals[idx] : undefined;
        out.push({ table, column: c, value: toNum(raw) });
      });
    } else {
      cols.forEach((c) => out.push({ table, column: c, value: null }));
    }
  }
  return out;
}

/** 解析对齐文本表格，取第一行数据的第一列值（runSqlRaw 返回完整表格时用） */
function parseFirstValue(raw: string | number | null): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw === "ERROR" || raw.includes("失败")) return null;
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const dataLine = lines.find(
    (l) => !/^-+$/.test(l) && !/^\(.*行.*\)$/.test(l) && l !== lines[0] && l !== "v",
  );
  return toNum(dataLine?.split("|")[0]);
}

function toNum(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export { GlossaryError };
