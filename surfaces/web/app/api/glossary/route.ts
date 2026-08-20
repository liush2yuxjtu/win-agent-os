import { NextResponse } from "next/server";
import { getAgentPaths } from "@agent/platform";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { Glossary } from "../../../../../packages/glossarizer/extension/lib/glossary";
import { renderWorkbook } from "../../../../../packages/glossarizer/extension/lib/excel";
import { importEditsFromXlsx } from "../../../../../packages/glossarizer/extension/lib/excel-import";
import { fetchSnapshot, type SnapshotValue } from "../../../../../packages/glossarizer/extension/lib/snapshot";

/**
 * /api/glossary —— glossarizer channel 的编辑/求值路由（业务专家界面后端）。
 *   GET  : evaluate（拉真实数据）→ 导出公式驱动 xlsx
 *   POST : 收可编辑单元格 → SheetJS 更新 xlsx → 写回 rules.json → 重算 → 返回新 xlsx
 */
const ROOT = getAgentPaths().repoRoot;
const GLOSSARY = resolve(ROOT, "configs/qianchuan.glossary.json");
const RULES = resolve(ROOT, "configs/qianchuan.rules.json");
const XLSX_PATH = resolve(ROOT, "glossary-review.xlsx");
const MCP = "http://127.0.0.1:7331/mcp";
/** 复用 MCP session（初始化一次，后续直接调用，避免每次 3 次握手） */
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
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "glossary-api", version: "1" } },
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

/** 规则展开 SQL（IF→CASE WHEN，支持条件内逗号；ratio 配置值由引擎包 MAX） */
function ruleSql(g: Glossary, ruleName: string, date: string): string {
  const expr = g.expand(ruleName, "sql");
  const sql = expr
    .replace(/IF\(([\s\S]+?), TRUE, FALSE\)/g, "CASE WHEN $1 THEN 1 ELSE 0 END")
    .replace(/\bTRUE\b/g, "1")
    .replace(/\bFALSE\b/g, "0");
  return (
    `SELECT TOP 1 ${sql} AS result FROM [WIN_DOUYIN].[dbo].[千川素材数据_素材列表] ` +
    `CROSS JOIN [video_management].[dbo].[QC_MONTAGE_PRODUCT] ` +
    `WHERE [WIN_DOUYIN].[dbo].[千川素材数据_素材列表].STAT_TIME = '${date}' ` +
    `AND [video_management].[dbo].[QC_MONTAGE_PRODUCT].STATE = '1'`
  );
}

async function runSqlRaw(sql: string): Promise<string> {
  return mcpCall(sql, 100);
}

async function evaluateAndExport(date = "2026-08-15") {
  const g = new Glossary(GLOSSARY, RULES, "sqlserver");
  const results: Record<string, { excel: string; sql: string; result: string; at: string }> = {};
  for (const r of g.listRules()) {
    results[r.name] = {
      excel: g.expand(r.name, "excel"),
      sql: ruleSql(g, r.name, date),
      result: await runSql(ruleSql(g, r.name, date)),
      at: date,
    };
  }
  const snapshot = await fetchSnapshot(g, runSqlRaw, date);
  const wb = renderWorkbook(g, results, snapshot);
  writeFileSync(XLSX_PATH, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return { g, results, snapshot, xlsx: readFileSync(XLSX_PATH) };
}

export async function GET() {
  try {
    const { results, xlsx } = await evaluateAndExport();
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="glossary-review.xlsx"',
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      /** 可编辑单元格：{ sheet: "业务规则"|"业务动作", row: 规则名, col: 列名, value: string }[] */
      edits: { sheet: string; row: string; col: string; value: string }[];
      date?: string;
    };
    if (!body.edits || body.edits.length === 0) {
      return NextResponse.json({ ok: false, error: "edits 为空" }, { status: 400 });
    }

    // 1. 用 SheetJS 把编辑写入当前 xlsx 的可编辑单元格
    const wb = XLSX.read(readFileSync(XLSX_PATH), { type: "buffer" });
    for (const e of body.edits) {
      const ws = wb.Sheets[e.sheet];
      if (!ws) return NextResponse.json({ ok: false, error: `sheet 不存在: ${e.sheet}` }, { status: 400 });
      // 按 规则名/触发规则 定位行（第 2 行起），按列名定位列
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);
      const idx = rows.findIndex((r) => r["规则名"] === e.row || r["触发规则"] === e.row);
      if (idx < 0) return NextResponse.json({ ok: false, error: `行不存在: ${e.row}` }, { status: 400 });
      const colLetter = XLSX.utils.encode_col(XLSX.utils.decode_range("A1").s.c + Object.keys(rows[0]).indexOf(e.col));
      const cell = ws[XLSX.utils.encode_cell({ r: idx + 1, c: Object.keys(rows[0]).indexOf(e.col) })];
      ws[XLSX.utils.encode_cell({ r: idx + 1, c: Object.keys(rows[0]).indexOf(e.col) })] = {
        t: "s",
        v: e.value,
        ...(cell ? { s: cell.s } : {}),
      };
      void colLetter;
    }
    const editedPath = resolve(ROOT, "glossary-review-edited.xlsx");
    writeFileSync(editedPath, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

    // 2. 写回 rules.json（校验术语引用）
    const imp = importEditsFromXlsx(editedPath, GLOSSARY, RULES);
    if (imp.errors.length > 0) {
      return NextResponse.json({ ok: false, errors: imp.errors }, { status: 400 });
    }

    // 3. 重新 evaluate + 导出
    const { results, xlsx } = await evaluateAndExport(body.date);
    return NextResponse.json({
      ok: true,
      changes: imp.changes,
      results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.result])),
      xlsxBase64: Buffer.from(xlsx).toString("base64"),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
