/**
 * Shared response formatting helpers: convert structured dictionary data into
 * concise, agent-friendly markdown + structured content.
 */
import type { TableDoc } from "../types.js";

/** Markdown for a single field row. */
export function fieldMarkdown(f: TableDoc["fields"][number]): string {
  const pk = f.isPrimaryKey ? " 🔑" : "";
  const status = f.status && f.status !== "有效" ? ` (${f.status})` : "";
  const enumNote = f.enum ? ` 枚举:${Object.entries(f.enum).map(([k, v]) => `${k}=${v}`).join(" | ")}` : "";
  return `- \`${f.name}\`${pk} \`${f.type}\`${status}${f.chineseName ? ` ${f.chineseName}` : ""}${f.description ? ` — ${f.description}` : ""}${f.sample ? ` 例:${f.sample}` : ""}${enumNote}`;
}

/** Full markdown rendering of one table doc. */
export function tableDocMarkdown(t: TableDoc): string {
  const lines: string[] = [];
  lines.push(`# ${t.table} · ${t.chineseName}`);
  lines.push("");
  lines.push(`- 数据库: \`${t.database}\` · Schema: \`${t.schema}\``);
  if (t.businessDomain) lines.push(`- 业务域: ${t.businessDomain}`);
  if (t.primaryKey) lines.push(`- 主键: \`${t.primaryKey}\``);
  if (t.dataSource) lines.push(`- 数据来源: ${t.dataSource}`);
  if (t.tags?.length) lines.push(`- 标签: ${t.tags.join("、")}`);
  if (t.tableStatus) lines.push(`- 表状态: ${t.tableStatus}`);
  lines.push("");
  if (t.description) {
    lines.push("## 说明");
    lines.push(t.description);
    lines.push("");
  }
  lines.push(`## 字段 (${t.fields.length})`);
  lines.push("");
  const fieldList = t.fields
    .slice()
    .sort((a, b) => Number(b.isPrimaryKey) - Number(a.isPrimaryKey))
    .map(fieldMarkdown);
  lines.push(...fieldList);
  if (t.relations.length) {
    lines.push("");
    lines.push(`## 关联表 (${t.relations.length})`);
    lines.push("");
    for (const r of t.relations) {
      lines.push(`- **${r.target}** ${r.cardinality ? `(${r.cardinality})` : ""}`);
      if (r.joinKey) lines.push(`  - Join: \`${r.joinKey}\``);
      if (r.description) lines.push(`  - ${r.description}`);
    }
  }
  if (t.knownIssues.length) {
    lines.push("");
    lines.push("## 已知问题");
    lines.push("");
    for (const issue of t.knownIssues) lines.push(`- ${issue}`);
  }
  return lines.join("\n");
}

/** Render search hits as a compact list. */
export function searchMarkdown(hits: Array<{
  table: string; chineseName: string; database: string; businessDomain?: string; description: string;
}>, limit: number): string {
  if (hits.length === 0) return "没有匹配的表。换个关键词试试。";
  const lines = hits.map((h, i) => {
    const domain = h.businessDomain ? ` · ${h.businessDomain}` : "";
    const desc = h.description ? ` — ${h.description.slice(0, 90)}` : "";
    return `${i + 1}. **${h.table}** · ${h.chineseName} (\`${h.database}\`${domain})${desc}`;
  });
  lines.push("");
  lines.push(`共 ${hits.length} 条结果${limit < hits.length ? ` (前 ${hits.length})` : ""}。可用 qc_get_table_doc 查看详情。`);
  return lines.join("\n");
}
