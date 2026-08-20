import { defineTool } from "eve/tools";
import { Glossary, GlossaryError } from "../lib/glossary";
import extension from "../extension";

/**
 * 业务专家视图：把整个词典+规则渲染成一份可读的公式清单（markdown）。
 * 每个术语给出：定义、聚合语义、展开后的 Excel 公式、字段溯源（表/列/标注人/口径）。
 * 业务专家直接看这份清单确认「公式是对的、口径可溯源」。
 */
export default defineTool({
  description:
    "渲染业务专家公式视图：输出当前域的完整公式清单（markdown）——每个业务术语的定义、聚合语义、展开后的 Excel 公式、绑定字段溯源（物理表/列/标注人/口径注释），以及每条业务规则的表达式和展开。业务专家核对口径用。",
  inputSchema: {},
  async execute() {
    const { glossaryPath, rulesPath, dialect } = extension.config;
    const g = new Glossary(glossaryPath, rulesPath, dialect);

    const lines: string[] = [];
    lines.push(`# 业务术语公式视图（${g.validate().domain}）`);
    lines.push("");
    lines.push(`> 词典: \`${glossaryPath}\` · 规则库: \`${rulesPath}\` · 方言: ${dialect}`);
    lines.push("");

    lines.push("## 一、术语公式清单");
    lines.push("");
    lines.push("| 术语 | 定义 | 聚合语义 | Excel 公式（展开） | 字段溯源 |");
    lines.push("|------|------|----------|--------------------|----------|");
    for (const t of g.listTerms()) {
      let excel = "";
      try {
        excel = g.expand(t.name, "excel");
      } catch (e) {
        excel = `⚠ ${e instanceof GlossaryError ? e.message : "展开失败"}`;
      }
      const agg = JSON.stringify(t.aggregation).replace(/"/g, "");
      const resolved = g.resolve(t.name);
      const src = resolved.sources
        .map((s) => `\`${s.table}.${s.column}\`（${s.annotated_by}${s.unit ? `, ${s.unit}` : ""}）`)
        .join("；");
      lines.push(`| **${t.name}** | ${t.definition} | \`${agg}\` | \`${excel}\` | ${src || "（无字段绑定）"} |`);
    }

    lines.push("");
    lines.push("## 二、业务规则清单");
    lines.push("");
    lines.push("| 规则 | 表达式 | 引用的术语 | 创建人 | 说明 |");
    lines.push("|------|--------|-----------|--------|------|");
    for (const r of g.listRules()) {
      lines.push(`| **${r.name}** | \`${r.expression}\` | ${r.terms.join("、")} | ${r.owner} | ${r.note ?? ""} |`);
    }

    lines.push("");
    lines.push("## 三、口径提示");
    lines.push("");
    lines.push("- 「平均」类术语都是加权口径（分子分母各自 SUM 再相除），**不是**简单 AVERAGE——例如「本周平均ROI」= SUM(本周产出)/SUM(本周消耗)");
    lines.push("- 每个术语可继续用 trace 溯源到标注人；字段可继续用 resolve 查口径注释");
    lines.push("");

    return { markdown: lines.join("\n") };
  },
});
