import { defineTool } from "eve/tools";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Glossary, GlossaryError, type RulesConfig } from "../lib/glossary";
import extension from "../extension";

/**
 * 业务专家组合新规则：用已有术语写规则表达式，追加到规则库。
 * 规则必须引用词典里存在的术语——compose 前先校验，非法引用直接拒绝。
 */
export default defineTool({
  description:
    "业务专家创建/更新业务规则：用术语词典里已存在的术语（如 ROI、产出、消耗、品线基线ROI）组合规则表达式（如 IF(ROI > {品线基线ROI}, TRUE, FALSE)），写入规则库 JSON。引用的术语必须已在词典中，否则拒绝。规则名重复时更新原规则。",
  inputSchema: z.object({
    ruleName: z.string().describe("规则名，如 ROI达标"),
    expression: z.string().describe("规则表达式，术语用名称直接写，如 IF(ROI > 3, TRUE, FALSE)"),
    terms: z.array(z.string()).describe("该规则引用的术语名列表"),
    owner: z.string().describe("规则创建人（业务专家）"),
    note: z.string().optional().describe("口径说明，如「基线来自品线配置表」"),
    actionName: z.string().optional().describe("动作名，如 启动追投 / 停止追投 / 人工复核"),
    actionType: z.enum(["start", "stop", "review", "custom"]).optional().describe("动作类型"),
    actionTrigger: z.string().optional().describe("触发说明，如「判定为 TRUE 时执行」"),
    actionParams: z.record(z.string(), z.string()).optional().describe("动作参数（业务专家自定义键值）"),
  }),
  async execute({ ruleName, expression, terms, owner, note, actionName, actionType, actionTrigger, actionParams }) {
    const { glossaryPath, rulesPath, dialect } = extension.config;
    const g = new Glossary(glossaryPath, rulesPath, dialect);

    // 引用校验：terms 必须都在词典里
    const missing = terms.filter((t) => {
      try {
        g.resolve(t);
        return false;
      } catch {
        return true;
      }
    });
    if (missing.length > 0) {
      return {
        error: `引用了词典中不存在的术语: ${missing.join("、")}。先 resolve 确认术语名。`,
      };
    }

    // 写入规则库（保留原文件，追加/更新一条）
    const abs = resolve(process.cwd(), rulesPath);
    let rulesCfg: RulesConfig;
    try {
      rulesCfg = JSON.parse(readFileSync(abs, "utf8")) as RulesConfig;
    } catch {
      return { error: `无法读取规则库: ${rulesPath}` };
    }
    const idx = rulesCfg.rules.findIndex((r) => r.name === ruleName);
    const entry = {
      name: ruleName,
      expression,
      terms,
      owner,
      note,
      version: "2",
      ...(actionName
        ? {
            action: {
              name: actionName,
              type: actionType ?? "review",
              trigger: actionTrigger ?? "判定为 TRUE 时执行",
              owner,
              ...(actionParams ? { params: actionParams } : {}),
            },
          }
        : {}),
    } as (typeof rulesCfg.rules)[number];
    if (idx >= 0) rulesCfg.rules[idx] = entry;
    else rulesCfg.rules.push(entry);
    writeFileSync(abs, JSON.stringify(rulesCfg, null, 2) + "\n");

    return {
      ok: true,
      written: abs,
      rule: entry,
      verify: {
        expanded: g.expand(ruleName, "excel"),
        trace: g.trace(ruleName),
      },
    };
  },
});
