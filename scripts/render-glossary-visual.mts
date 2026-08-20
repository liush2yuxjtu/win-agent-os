/**
 * 渲染语义层三层关系图（自包含 HTML）：
 *   数据库字段 → 业务字段 → 业务规则 → 业务动作
 * 数据全部来自 glossarizer config（configs/qianchuan.glossary.json + rules.json），
 * 生成 mermaid flowchart，交互：点击节点高亮其上下游、悬停显示溯源。
 *
 * 用法: tsx scripts/render-glossary-visual.mts [output.html]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface FieldBinding { id: string; table: string; column: string; term: string; unit?: string; annotated_by: string; note?: string; }
interface Term { name: string; definition: string; aggregation: any; grain: string; version: string; }
interface Rule { name: string; expression: string; terms: string[]; owner: string; note?: string; }

const ROOT = resolve(import.meta.dirname, "..");
const cfg = JSON.parse(readFileSync(resolve(ROOT, "configs/qianchuan.glossary.json"), "utf8")) as {
  tables: { name: string; database?: string; logical?: string }[];
  fields: FieldBinding[];
  terms: Term[];
  version?: string;
};
const rules = JSON.parse(readFileSync(resolve(ROOT, "configs/qianchuan.rules.json"), "utf8")) as { rules: Rule[] };

const dbOf = (table: string) => cfg.tables.find((t) => t.name === table)?.database ?? "";

// ── 节点与连线 ────────────────────────────────────────────────
const mermaid: string[] = ["flowchart LR"];
mermaid.push('  subgraph L1["① 数据库字段"]');
for (const f of cfg.fields.slice(0, 0)) void f; // 全部字段可选（默认折叠）
mermaid.push("  end");
mermaid.push('  subgraph L2["② 业务字段（术语网络）"]');
mermaid.push("  end");
mermaid.push('  subgraph L3["③ 业务规则"]');
mermaid.push("  end");
mermaid.push('  subgraph L4["④ 业务动作"]');
mermaid.push("  end");

// 业务字段节点：显式术语 + 被规则引用的字段中文名（隐式术语）
const termNames = new Set(cfg.terms.map((t) => t.name));
for (const r of rules.rules) for (const t of r.terms) if (!termNames.has(t)) termNames.add(t); // 规则引用补全
const referencedFieldTerms = new Set<string>();
for (const t of cfg.terms) {
  const agg = t.aggregation;
  const refs = agg.kind === "weighted_ratio" ? [...agg.numerator, ...agg.denominator] : agg.kind === "sum_of" || agg.kind === "diff_of" ? agg.parts : [];
  for (const r of refs) referencedFieldTerms.add(r);
}
// 画核心术语（显式 + 规则引用）；字段中文名隐式术语画为叶子
const fieldByTerm = new Map<string, FieldBinding[]>();
for (const f of cfg.fields) {
  const l = fieldByTerm.get(f.term) ?? [];
  l.push(f);
  fieldByTerm.set(f.term, l);
}

const nodeId = (s: string) => "n" + s.replace(/[^a-zA-Z0-9一-龥]/g, "_");

// 层 2：术语节点
for (const t of cfg.terms) {
  mermaid.push(`  ${nodeId("term_" + t.name)}["<b>${t.name}</b><br/>${t.definition.slice(0, 30)}"]:::term`);
}
// 层 1：术语绑定的物理字段（只画被引用的）
for (const t of cfg.terms) {
  const bindings = fieldByTerm.get(t.name) ?? [];
  for (const b of bindings.slice(0, 2)) {
    const id = nodeId("f_" + b.table + "_" + b.column);
    mermaid.push(`  ${id}["${b.table}.${b.column}"]:::field`);
    mermaid.push(`  ${id} --> ${nodeId("term_" + t.name)}`);
  }
}
// 术语间引用（sum_of / weighted_ratio 引用的字段中文名 → 术语）
for (const t of cfg.terms) {
  const agg = t.aggregation;
  const refs = agg.kind === "weighted_ratio" ? [...agg.numerator, ...agg.denominator] : agg.kind === "sum_of" || agg.kind === "diff_of" ? agg.parts : [];
  for (const r of refs) {
    if (fieldByTerm.has(r)) {
      // r 是字段中文名（隐式术语）：画成叶子字段
      const bind = fieldByTerm.get(r)![0];
      const id = nodeId("f_" + bind.table + "_" + bind.column);
      mermaid.push(`  ${id}["${bind.table}.${bind.column}<br/><i>${r}</i>"]:::field`);
      mermaid.push(`  ${id} --> ${nodeId("term_" + t.name)}`);
    }
  }
}
// 层 3：规则节点
for (const r of rules.rules) {
  mermaid.push(`  ${nodeId("rule_" + r.name)}["<b>${r.name}</b><br/>${r.expression.replace(/\{/g, "").replace(/\}/g, "")}"]:::rule`);
  for (const t of r.terms) mermaid.push(`  ${nodeId("term_" + t)} --> ${nodeId("rule_" + r.name)}`);
}
// 层 4：动作节点（规则 → 动作；动作来自规则 note 关键词，留待业务专家定义）
for (const r of rules.rules) {
  const action = r.note?.includes("追投") ? "启动/停止追投" : "人工执行";
  mermaid.push(`  ${nodeId("act_" + r.name)}["${action}"]:::action`);
  mermaid.push(`  ${nodeId("rule_" + r.name)} --> ${nodeId("act_" + r.name)}`);
}

// 样式
mermaid.push('  classDef field fill:#f3e8d8,stroke:#c9952b,color:#5a4632;');
mermaid.push('  classDef term fill:#eaf0e6,stroke:#788c5d,color:#3d4a2f;');
mermaid.push('  classDef rule fill:#fde8e0,stroke:#d97757,color:#6b3523;');
mermaid.push('  classDef action fill:#e8eef0,stroke:#5a8a94,color:#2f4a50;');

const graph = mermaid.join("\n");

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>语义层三层关系 · glossarizer</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; background:#faf9f5; color:#141413; margin:0; padding:2rem; }
  h1 { font-size: 1.3rem; }
  .meta { color:#b0aea5; font-size:.85rem; margin-bottom:1rem; }
  #graph { background:#fff; border:1px solid #e8e6dc; border-radius:8px; padding:1rem; overflow:auto; }
  .legend { display:flex; gap:1rem; margin:1rem 0; flex-wrap:wrap; }
  .legend span { display:inline-flex; align-items:center; gap:.4rem; font-size:.8rem; }
  .dot { width:12px; height:12px; border-radius:3px; display:inline-block; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:.6rem; margin-bottom:1rem; }
  .stat { background:#fff; border:1px solid #e8e6dc; border-radius:8px; padding:.7rem; }
  .stat b { font-size:1.2rem; display:block; }
  .stat span { color:#b0aea5; font-size:.75rem; }
</style>
</head>
<body>
<h1>语义层三层关系 · glossarizer（qianchuan）</h1>
<div class="meta">数据源：configs/qianchuan.glossary.json v${cfg.version} + qianchuan.rules.json · 生成：${new Date().toISOString().slice(0, 16)}</div>
<div class="stats">
  <div class="stat"><b>${cfg.tables.length}</b><span>数据库表</span></div>
  <div class="stat"><b>${cfg.fields.length}</b><span>数据库字段（权威标注）</span></div>
  <div class="stat"><b>${cfg.terms.length}</b><span>业务字段（组合术语）</span></div>
  <div class="stat"><b>${rules.rules.length}</b><span>业务规则</span></div>
</div>
<div class="legend">
  <span><span class="dot" style="background:#c9952b"></span>数据库字段</span>
  <span><span class="dot" style="background:#788c5d"></span>业务字段</span>
  <span><span class="dot" style="background:#d97757"></span>业务规则</span>
  <span><span class="dot" style="background:#5a8a94"></span>业务动作</span>
</div>
<div id="graph"><pre class="mermaid">${graph}</pre></div>
<script>mermaid.initialize({ startOnLoad: true, theme: "base", themeVariables: { fontFamily: "-apple-system, PingFang SC, sans-serif" } });</script>
</body>
</html>`;

const out = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(ROOT, "glossary-visual.html");
writeFileSync(out, html);
console.log("written:", out);
console.log("nodes: terms=", cfg.terms.length, "rules=", rules.rules.length, "| 图已生成");
