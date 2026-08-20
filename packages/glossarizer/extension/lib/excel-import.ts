import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { Glossary } from "./glossary";

/**
 * Excel → JSON 双向映射核心（被 scripts/import-excel 与 /api/glossary 共用）。
 *
 * 业务专家在 Excel/Univer 里改的可编辑单元格 → 校验 → 写回 rules.json：
 *   - Sheet「业务规则」B 列（表达式，{术语} 写法）→ rules[].expression
 *   - Sheet「业务动作」B~F 列（动作名/类型/触发条件/参数/执行人）→ rules[].action
 * 校验：表达式引用的术语必须存在于词典；非法引用拒绝（errors 返回，不写回）。
 */

export interface ImportResult {
  changes: string[];
  errors: string[];
  written: boolean;
}

export function importEditsFromXlsx(
  xlsxPath: string,
  glossaryPath: string,
  rulesPath: string,
  opts: { dryRun?: boolean } = {},
): ImportResult {
  const g = new Glossary(glossaryPath, rulesPath, "sqlserver");
  const rulesCfg = JSON.parse(readFileSync(rulesPath, "utf8")) as { rules: any[] };
  const wb = XLSX.read(readFileSync(xlsxPath), { type: "buffer" });
  const wsRules = wb.Sheets["业务规则"];
  const wsActions = wb.Sheets["业务动作"];
  if (!wsRules || !wsActions) {
    return { changes: [], errors: ["缺少「业务规则」或「业务动作」sheet"], written: false };
  }

  const changes: string[] = [];
  const errors: string[] = [];

  const rulesRows = XLSX.utils.sheet_to_json(wsRules) as Record<string, string>[];
  for (const row of rulesRows) {
    const name = row["规则名"];
    const expr = row["表达式"]?.trim();
    const rule = rulesCfg.rules.find((r) => r.name === name);
    if (!rule) {
      errors.push(`规则「${name}」在 JSON 中不存在`);
      continue;
    }
    if (expr && expr !== rule.expression) {
      const refs = [...expr.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      const missing = refs.filter((t) => {
        try {
          g.resolve(t);
          return false;
        } catch {
          return true;
        }
      });
      if (missing.length > 0) {
        errors.push(`规则「${name}」引用了不存在的术语: ${missing.join("、")}，拒绝写回`);
        continue;
      }
      changes.push(`规则「${name}」表达式: ${rule.expression} → ${expr}`);
      rule.expression = expr;
    }
  }

  const actionRows = XLSX.utils.sheet_to_json(wsActions) as Record<string, string>[];
  for (const row of actionRows) {
    const name = row["触发规则"];
    const rule = rulesCfg.rules.find((r) => r.name === name);
    if (!rule) continue;
    const newAction = {
      name: row["动作名"]?.trim(),
      type: row["动作类型"]?.trim(),
      trigger: row["触发条件"]?.trim(),
      owner: row["执行人"]?.trim(),
      params: row["动作参数"]?.trim() ? JSON.parse(row["动作参数"]) : undefined,
    };
    if (!newAction.name) {
      if (rule.action) {
        changes.push(`规则「${name}」动作已删除`);
        delete rule.action;
      }
      continue;
    }
    const old = rule.action;
    const same =
      old &&
      old.name === newAction.name &&
      old.type === newAction.type &&
      (old.trigger ?? "") === (newAction.trigger ?? "") &&
      (old.owner ?? "") === (newAction.owner ?? "") &&
      JSON.stringify(old.params ?? {}) === JSON.stringify(newAction.params ?? {});
    if (!same) {
      changes.push(`规则「${name}」动作: ${JSON.stringify(old ?? {})} → ${JSON.stringify(newAction)}`);
      rule.action = newAction;
    }
  }

  if (errors.length > 0) return { changes, errors, written: false };
  if (changes.length === 0) return { changes, errors, written: false };

  if (!opts.dryRun) {
    writeFileSync(rulesPath, JSON.stringify(rulesCfg, null, 2) + "\n");
    return { changes, errors, written: true };
  }
  return { changes, errors, written: false };
}

/** 由 resolve 过的路径构造并调用（供脚本/API 使用） */
export function importEdits(projectRoot: string, xlsxFile = "glossary-review.xlsx", opts: { dryRun?: boolean } = {}) {
  return importEditsFromXlsx(
    resolve(projectRoot, xlsxFile),
    resolve(projectRoot, "configs/qianchuan.glossary.json"),
    resolve(projectRoot, "configs/qianchuan.rules.json"),
    opts,
  );
}
