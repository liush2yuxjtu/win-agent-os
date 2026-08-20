import { NextResponse } from "next/server";
import { getAgentPaths } from "@agent/platform";
import { resolve } from "node:path";
import { Glossary } from "../../../../../../packages/glossarizer/extension/lib/glossary";
import { fetchSnapshot } from "../../../../../../packages/glossarizer/extension/lib/snapshot";

/**
 * /api/glossary/overview —— 业务口径总览（术语值 + 规则判定 + 动作 + 快照统计）。
 * 术语值在服务端按快照计算（与 Excel SUMIF 公式同语义），规则判定走 SQL evaluate。
 */
const ROOT = getAgentPaths().repoRoot;
const GLOSSARY = resolve(ROOT, "configs/qianchuan.glossary.json");
const RULES = resolve(ROOT, "configs/qianchuan.rules.json");
const MCP = "http://127.0.0.1:7331/mcp";

let mcpSid: string | null = null;
async function ensureSession(): Promise<string> {
  if (mcpSid) return mcpSid;
  const init = await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "overview", version: "1" } },
    }),
  });
  mcpSid = init.headers.get("mcp-session-id") ?? "";
  await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", "mcp-session-id": mcpSid },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  return mcpSid;
}
async function mcpCall(sql: string, maxRows = 5): Promise<string> {
  const sid = await ensureSession();
  const call = await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sid },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "qc_query_database", arguments: { database: "WIN_DOUYIN", query: sql, max_rows: maxRows } },
    }),
  });
  const text = await call.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  if (!line) return "ERROR";
  try {
    const payload = JSON.parse(line.slice(5));
    const content = payload.result?.content?.[0]?.text ?? "";
    if (payload.isError || content.startsWith("Error") || content.includes("失败")) return "ERROR";
    return content;
  } catch {
    return "ERROR";
  }
}

async function runSql(sql: string): Promise<string> {
  const content = await mcpCall(sql, 5);
  if (content === "ERROR") return "ERROR";
  const rows = content.split("\n").map((l: string) => l.trim()).filter(Boolean);
  return rows.find((l: string) => !l.startsWith("---") && !/^\(.*行.*\)$/.test(l) && l !== "result") ?? "ERROR";
}

async function runSqlRaw(sql: string): Promise<string> {
  return mcpCall(sql, 100);
}

/** 服务端术语求值：与 Excel SUMIF/MAXIFS 公式同语义（快照 JS 计算） */
function evalTerm(g: Glossary, termName: string, snap: Map<string, number>): number | null {
  const t = g.listTerms().find((x) => x.name === termName);
  if (!t) return null;
  const sumOf = (fieldTerm: string): number => {
    // 字段快照求和（一个业务字段可能绑定多个物理列）
    const bindings = g
      .listFields()
      .filter((f) => f.term === fieldTerm)
      .map((f) => snap.get(`${f.table}.${f.column}`) ?? 0);
    return bindings.reduce((a, b) => a + b, 0);
  };
  switch (t.aggregation.kind) {
    case "weighted_ratio": {
      const num = t.aggregation.numerator.map(sumOf).reduce((a, b) => a + b, 0);
      const den = t.aggregation.denominator.map(sumOf).reduce((a, b) => a + b, 0);
      return den === 0 ? 0 : num / den;
    }
    case "sum_of":
      return t.aggregation.parts.map(sumOf).reduce((a, b) => a + b, 0);
    case "diff_of": {
      const parts = t.aggregation.parts.map(sumOf);
      return parts.slice(1).reduce((a, b) => a - b, parts[0] ?? 0);
    }
    case "sum":
      return sumOf(t.name);
    case "count": {
      const bindings = g.listFields().filter((f) => f.term === t.name);
      return bindings.filter((f) => (snap.get(`${f.table}.${f.column}`) ?? 0) > 0).length;
    }
    case "ratio": {
      // 配置值：取快照中该术语字段的最大值（与 MAXIFS 一致）
      const vals = g
        .listFields()
        .filter((f) => f.term === t.name)
        .map((f) => snap.get(`${f.table}.${f.column}`) ?? 0);
      return vals.length ? Math.max(...vals) : null;
    }
    case "avg": {
      const bindings = g.listFields().filter((f) => f.term === t.name);
      const vals = bindings.map((f) => snap.get(`${f.table}.${f.column}`) ?? 0);
      const n = vals.filter((v) => v > 0).length;
      return n === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / n;
    }
  }
}

export async function GET() {
  try {
    const date = "2026-08-15";
    const g = new Glossary(GLOSSARY, RULES, "sqlserver");
    const snapshot = await fetchSnapshot(g, runSqlRaw, date);
    const snap = new Map(snapshot.map((s) => [`${s.table}.${s.column}`, s.value ?? 0]));

    const terms = g.listTerms().map((t) => ({
      name: t.name,
      definition: t.definition,
      aggregation: t.aggregation.kind,
      value: evalTerm(g, t.name, snap),
    }));

    const rules: { name: string; expression: string; result: string; action: any }[] = [];
    for (const r of g.listRules()) {
      rules.push({
        name: r.name,
        expression: r.expression,
        result: await runSql(ruleSql(g, r.name, date)),
        action: r.action ?? null,
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      snapshot: {
        filled: snapshot.filter((s) => s.value != null).length,
        total: snapshot.length,
        byTable: Object.entries(
          snapshot.reduce<Record<string, number>>((acc, s) => {
            acc[s.table] = (acc[s.table] ?? 0) + 1;
            return acc;
          }, {}),
        ).map(([table, count]) => ({ table, count })),
      },
      terms,
      rules,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

function ruleSql(g: Glossary, ruleName: string, date: string): string {
  const expr = g
    .expand(ruleName, "sql")
    .replace(/IF\(([\s\S]+?), TRUE, FALSE\)/g, "CASE WHEN $1 THEN 1 ELSE 0 END")
    .replace(/\bTRUE\b/g, "1")
    .replace(/\bFALSE\b/g, "0");
  return (
    `SELECT TOP 1 ${expr} AS result FROM [WIN_DOUYIN].[dbo].[千川素材数据_素材列表] ` +
    `CROSS JOIN [video_management].[dbo].[QC_MONTAGE_PRODUCT] ` +
    `WHERE [WIN_DOUYIN].[dbo].[千川素材数据_素材列表].STAT_TIME = '${date}' ` +
    `AND [video_management].[dbo].[QC_MONTAGE_PRODUCT].STATE = '1'`
  );
}
