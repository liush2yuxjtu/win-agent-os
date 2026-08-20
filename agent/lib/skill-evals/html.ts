/**
 * 两类 eval 报告的暖色调单文件 HTML 生成器。
 * 样式规范沿用 ai-control 报告（business-logic.md 4.2-4.6）：
 * 暖色（琥珀 #e07a3a / 珊瑚 #d94f4f / 金色 #c9952b / 暖棕 #8b6e4e / 青绿 #3a8e8e）、
 * 无冷色、纯 HTML/CSS 单文件、响应式。
 */

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>
  :root { --amber:#e07a3a; --coral:#d94f4f; --gold:#c9952b; --brown:#8b6e4e; --teal:#3a8e8e; --bg:#faf6ef; --card:#fffdf8; --ink:#3a322a; --muted:#8a7d6c; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
  .wrap { max-width:960px; margin:0 auto; padding:28px 20px 60px; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:-0.02em; }
  .sub { color:var(--muted); font-size:12px; margin-bottom:20px; }
  .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:24px; }
  .metric { background:var(--card); border:1px solid #eadfce; border-radius:14px; padding:14px 16px; box-shadow:0 2px 10px rgba(120,90,50,.05); }
  .metric .label { font-size:11px; color:var(--muted); }
  .metric .value { font-size:24px; font-weight:700; margin-top:4px; letter-spacing:-0.03em; }
  .ok { color:var(--teal); } .warn { color:var(--gold); } .bad { color:var(--coral); }
  .card { background:var(--card); border:1px solid #eadfce; border-radius:14px; padding:16px 18px; margin-bottom:14px; box-shadow:0 2px 10px rgba(120,90,50,.05); }
  .card h2 { font-size:14px; margin:0 0 10px; color:var(--brown); }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { text-align:left; color:var(--muted); font-weight:600; padding:6px 8px; border-bottom:1px solid #eadfce; }
  td { padding:8px; border-bottom:1px solid #f3ecdf; vertical-align:top; }
  .pill { display:inline-block; padding:1px 8px; border-radius:99px; font-size:11px; font-weight:600; }
  .pill-pass { background:#e3efe6; color:#2f6b4a; } .pill-fail { background:#f7e2dc; color:#8b4a36; }
  .pill-partial { background:#f6ecd7; color:#7a642f; } .pill-trigger { background:#eef0e4; color:#4d6b3a; }
  .reason { color:var(--muted); font-size:11px; margin-top:3px; }
  .output { background:#f6f1e8; border-radius:8px; padding:8px 10px; font-size:11px; color:#5a4f40; white-space:pre-wrap; max-height:160px; overflow:auto; }
  .advice { margin-top:16px; background:#fdf3e4; border:1px solid #ecd9b8; border-radius:12px; padding:12px 14px; font-size:12px; color:#6b5434; }
  @media (max-width:640px){ .metrics { grid-template-columns:1fr 1fr; } }
</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

import type { SkillEvalRun } from "./types";

/** Trigger 报告 HTML。 */
export function renderTriggerHtml(run: SkillEvalRun): string {
  const t = run.trigger;
  const acc = Math.round(t.accuracy * 100);
  const accClass = acc >= 80 ? "ok" : acc >= 60 ? "warn" : "bad";
  const rows = t.cases
    .map(
      (c) => `<tr>
  <td>${esc(c.prompt)}</td>
  <td><span class="pill ${c.expectedTrigger ? "pill-trigger" : "pill-fail"}">${c.expectedTrigger ? "应触发" : "不应触发"}</span></td>
  <td><span class="pill ${c.predictedTrigger ? "pill-trigger" : "pill-fail"}">${c.predictedTrigger ? "触发" : "不触发"}</span></td>
  <td><span class="pill ${c.pass ? "pill-pass" : "pill-fail"}">${c.pass ? "✓" : "✗"}</span></td>
  <td><div class="reason">${esc(c.reason)}</div></td>
</tr>`,
    )
    .join("");
  return shell(`Trigger 评估 · ${run.skillName}`, `
<h1>触发准确性评估（Trigger）</h1>
<div class="sub">技能 ${esc(run.skillName)} · ${esc(run.triggeredAt)} · description 路由命中测试</div>
<div class="metrics">
  <div class="metric"><div class="label">命中率</div><div class="value ${accClass}">${acc}%</div></div>
  <div class="metric"><div class="label">通过 / 总数</div><div class="value">${t.passed}/${t.total}</div></div>
  <div class="metric"><div class="label">误触发</div><div class="value ${t.falsePositives > 0 ? "bad" : "ok"}">${t.falsePositives}</div></div>
  <div class="metric"><div class="label">漏触发</div><div class="value ${t.falseNegatives > 0 ? "warn" : "ok"}">${t.falseNegatives}</div></div>
</div>
<div class="card"><h2>逐例判定</h2><table>
<thead><tr><th>用户提问</th><th>期望</th><th>模型判定</th><th>结果</th><th>依据</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<div class="advice"><b>提高触发的建议：</b>${t.falseNegatives > 0 ? "有「应触发未触发」的用例——在 description 中补充该类提问的关键词与同义表述。" : ""}${t.falsePositives > 0 ? "有「不应触发却触发」的用例——在 description 中明确排除边界场景，收窄路由范围。" : ""}${t.falsePositives === 0 && t.falseNegatives === 0 ? "当前路由精准，无需调整。" : ""}</div>
`);
}

/** Functional 报告 HTML。 */
export function renderFunctionalHtml(run: SkillEvalRun): string {
  const f = run.functional;
  const rate = Math.round(f.passRate * 100);
  const rateClass = rate >= 80 ? "ok" : rate >= 60 ? "warn" : "bad";
  const rows = f.cases
    .map(
      (c) => `<tr>
  <td>${esc(c.input)}</td>
  <td><span class="pill ${c.verdict === "pass" ? "pill-pass" : c.verdict === "partial" ? "pill-partial" : "pill-fail"}">${c.verdict === "pass" ? "通过" : c.verdict === "partial" ? "部分" : "失败"}</span></td>
  <td><div class="output">${esc(c.output || "（无输出）")}</div></td>
  <td><div class="reason">${esc(c.reason)}${c.expected ? `<br>期望：${esc(c.expected)}` : ""}</div></td>
</tr>`,
    )
    .join("");
  return shell(`功能评估 · ${run.skillName}`, `
<h1>功能正确性评估（Functional）</h1>
<div class="sub">技能 ${esc(run.skillName)} · ${esc(run.triggeredAt)} · 按 SKILL.md 指令执行质量</div>
<div class="metrics">
  <div class="metric"><div class="label">通过率</div><div class="value ${rateClass}">${rate}%</div></div>
  <div class="metric"><div class="label">通过 / 部分 / 失败</div><div class="value">${f.passed}/${f.partial}/${f.failed}</div></div>
</div>
<div class="card"><h2>逐项执行与评判</h2><table>
<thead><tr><th>任务输入</th><th>结果</th><th>执行输出</th><th>评判</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<div class="advice"><b>提高功能的建议：</b>${f.failed > 0 ? "存在失败用例——检查指令是否缺少关键步骤、口径是否完整（数据来源/判断阈值/输出格式）。" : ""}${f.partial > 0 ? "部分用例仅部分达标——细化指令中的输出要求与边界处理。" : ""}${f.failed === 0 && f.partial === 0 ? "指令执行稳定，保持现状。" : ""}</div>
`);
}
