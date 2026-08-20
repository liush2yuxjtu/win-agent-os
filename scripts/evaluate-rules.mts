/**
 * 把业务规则展开成 SQL 并在 QC 数据库上执行，产出「公式计算结果」。
 * 业务专家在 Excel 里看到的最终形态：规则公式 + 今天真实数据的求值结果。
 *
 * 用法: tsx scripts/evaluate-rules.mts [--date 2026-08-15] [--out results.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Glossary } from "../packages/glossarizer/extension/lib/glossary.ts";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const date = args.find((a) => a.startsWith("--date="))?.split("=")[1] ?? "2026-08-15";
const outPath = args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "results.json";

const g = new Glossary(
  resolve(ROOT, "configs/qianchuan.glossary.json"),
  resolve(ROOT, "configs/qianchuan.rules.json"),
  "sqlserver",
);

// 规则展开 SQL 引用了素材列表 + 品线配置两张表；包装成可执行查询。
// 注意：表达式里已是 [库].[dbo].[表].[列] 四段引用，FROM 需带出这两张表。
// Excel 的 IF(a, b, c) 在 T-SQL 里写成 CASE WHEN a THEN b ELSE c END；
// 条件内部可能含逗号（如 NULLIF(x, 0)），所以贪婪匹配到最外层 ", TRUE, FALSE)" 收尾。
// T-SQL 没有 TRUE/FALSE 字面量，用 1/0。
const IF2CASE = (expr: string) =>
  expr
    .replace(/IF\(([\s\S]+?), TRUE, FALSE\)/g, "CASE WHEN $1 THEN 1 ELSE 0 END")
    .replace(/\bTRUE\b/g, "1")
    .replace(/\bFALSE\b/g, "0");

const WRAP = (expr: string) =>
  `SELECT TOP 1 ${IF2CASE(expr)} AS result FROM [WIN_DOUYIN].[dbo].[千川素材数据_素材列表] ` +
  `CROSS JOIN [video_management].[dbo].[QC_MONTAGE_PRODUCT] ` +
  `WHERE [WIN_DOUYIN].[dbo].[千川素材数据_素材列表].STAT_TIME = '${date}' ` +
  `AND [video_management].[dbo].[QC_MONTAGE_PRODUCT].STATE = '1'`;

async function runSql(sql: string): Promise<{ value: string } | { error: string }> {
  const res = await fetch("http://127.0.0.1:7331/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "evaluate", version: "1" } },
    }),
  });
  const sid = res.headers.get("mcp-session-id") ?? "";
  await fetch("http://127.0.0.1:7331/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", "mcp-session-id": sid },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  const call = await fetch("http://127.0.0.1:7331/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sid },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "qc_query_database", arguments: { database: "WIN_DOUYIN", query: sql, max_rows: 5 } },
    }),
  });
  const text = await call.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) return { error: "无响应" };
  try {
    const payload = JSON.parse(dataLine.slice(5));
    const content = payload.result?.content?.[0]?.text ?? "";
    if (payload.isError || content.startsWith("Error") || content.includes("失败")) return { error: content.slice(0, 200) };
    // bridge 返回对齐文本表格：表头行 / 分隔行 / 数据行 / (N 行, 耗时) 元信息
    const rows = content.split("\n").map((l: string) => l.trim()).filter(Boolean);
    const dataRow = rows.find((l: string) => !l.startsWith("---") && !/^\(.*行.*\)$/.test(l) && !/^result$/.test(l));
    return { value: dataRow ?? content.slice(0, 120) };
  } catch {
    return { error: text.slice(0, 200) };
  }
}

const results: Record<string, { excel: string; sql: string; result: string | "ERROR"; at: string }> = {};
for (const r of g.listRules()) {
  const excel = g.expand(r.name, "excel");
  const expr = g.expand(r.name, "sql");
  const sql = WRAP(expr);
  const out = await runSql(sql);
  results[r.name] = {
    excel,
    sql,
    result: "value" in out ? out.value : `ERROR: ${out.error}`,
    at: date,
  };
  console.log(`  ${r.name}: ${"value" in out ? out.value : "ERROR"}`);
}

const outAbs = resolve(ROOT, outPath);
writeFileSync(outAbs, JSON.stringify(results, null, 2) + "\n");
console.log("results written:", outAbs);
