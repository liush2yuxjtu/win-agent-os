/**
 * 报告库（SQLite，node:sqlite 零依赖）。
 *
 * 目的：把 public/reports/ 下的 HTML 报告登记为服务端持久化的元数据清单，
 * 报告中心页面（app/reports/）从本库读取列表，不再依赖每次扫描目录；
 * save_report 保存文件时同步 upsert，保证"落盘即入册"。
 *
 * 表结构：
 *  - reports：报告元数据（id=文件名 slug 主键；title 从 HTML <title> 提取；
 *    dynamic 标记是否含 window.REPORT_SOURCES 数据契约——即"刷新自动拉数"的动态报告；
 *    archived 标记用户归档——归档后默认从报告中心隐藏，可筛选查看/恢复）
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAgentPaths } from "../../../../platform";

export function reportsDbPath(): string {
  return getAgentPaths().reportsDbPath;
}

export type ReportMeta = {
  /** 文件名 slug（不含 .html），同时是 DB 主键。 */
  id: string;
  /** 文件名，如 investment-summary-2026-08.html。 */
  name: string;
  /** 浏览器访问路径，如 /reports/investment-summary-2026-08.html。 */
  path: string;
  /** HTML <title>（提取失败时回退为文件名）。 */
  title: string;
  sizeBytes: number;
  /** 是否动态报告（含 window.REPORT_SOURCES 数据契约，刷新自动拉数）。 */
  dynamic: boolean;
  /** 是否已归档（用户归档后默认从列表隐藏，可筛选查看/恢复）。 */
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export function openReportsDb(): DatabaseSync {
  const dbPath = getAgentPaths().reportsDbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA busy_timeout = 2000;
    CREATE TABLE IF NOT EXISTS reports (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      path       TEXT NOT NULL,
      title      TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      dynamic    INTEGER NOT NULL DEFAULT 0,
      archived   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reports_updated ON reports(updated_at DESC);
  `);
  // 轻量迁移：旧库补 archived 列（照 chat_sessions 惯例）
  const columns = new Set(
    (db.prepare("PRAGMA table_info(reports)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!columns.has("archived")) {
    db.exec("ALTER TABLE reports ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
  }
  return db;
}

function rowToMeta(row: Record<string, unknown>): ReportMeta {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    title: String(row.title),
    sizeBytes: Number(row.size_bytes ?? 0),
    dynamic: Number(row.dynamic ?? 0) === 1,
    archived: Number(row.archived ?? 0) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** 从 HTML 提取 <title>（不解析完整文档，只取 head 区）。 */
function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(0, 4096));
  const title = match?.[1]?.trim();
  return title || null;
}

/** 报告是否含动态数据契约（window.REPORT_SOURCES）。 */
export function isDynamicReport(html: string): boolean {
  return html.includes("window.REPORT_SOURCES") || html.includes("REPORT_SOURCES");
}

/**
 * 登记一份报告（保存/扫描共用）。id 已存在且内容未变时保持原 created_at；
 * 内容有变化则更新 updated_at。返回最终元数据。
 */
export function registerReport(name: string, html: string): ReportMeta {
  const id = name.replace(/\.html$/i, "");
  const title = extractTitle(html) ?? id;
  const dynamic = isDynamicReport(html);
  const now = new Date().toISOString();
  const db = openReportsDb();
  const existing = db.prepare("SELECT created_at FROM reports WHERE id = ?").get(id) as
    | { created_at: string }
    | undefined;
  const createdAt = existing?.created_at ?? now;
  db.prepare(
    `INSERT INTO reports (id, name, path, title, size_bytes, dynamic, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       path = excluded.path,
       title = excluded.title,
       size_bytes = excluded.size_bytes,
       dynamic = excluded.dynamic,
       updated_at = excluded.updated_at`,
  ).run(id, name, `/reports/${name}`, title, Buffer.byteLength(html, "utf8"), dynamic ? 1 : 0, createdAt, now);
  db.close();
  return {
    id,
    name,
    path: `/reports/${name}`,
    title,
    sizeBytes: Buffer.byteLength(html, "utf8"),
    dynamic,
    archived: existing ? getReport(id)?.archived === true : false,
    createdAt,
    updatedAt: now,
  };
}

/** 归档/恢复报告（用户显式操作；重新生成/扫描不会改归档状态）。 */
export function archiveReport(id: string, archived: boolean): void {
  const db = openReportsDb();
  db.prepare("UPDATE reports SET archived = ? WHERE id = ?").run(archived ? 1 : 0, id);
  db.close();
}

/** 报告清单（按更新倒序）。 */
export function listReports(): ReportMeta[] {
  const db = openReportsDb();
  const rows = db.prepare("SELECT * FROM reports ORDER BY updated_at DESC, id").all() as Record<string, unknown>[];
  db.close();
  return rows.map(rowToMeta);
}

export function getReport(id: string): ReportMeta | null {
  const db = openReportsDb();
  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  db.close();
  return row ? rowToMeta(row) : null;
}

export function deleteReport(id: string): void {
  const db = openReportsDb();
  db.prepare("DELETE FROM reports WHERE id = ?").run(id);
  db.close();
}

/** 报告总数。 */
export function countReports(): number {
  const db = openReportsDb();
  const row = db.prepare("SELECT COUNT(*) AS n FROM reports").get() as { n: number };
  db.close();
  return Number(row.n);
}

/**
 * 扫描 public/reports/ 目录，把磁盘上已有但未入册的 HTML 报告补录进 DB
 * （覆盖 save_report 上线前生成的存量报告）。返回本次补录数。
 */
export function scanReportsDir(): number {
  const reportsDir = getAgentPaths().reportsDir;
  if (!fs.existsSync(reportsDir)) return 0;
  let added = 0;
  for (const entry of fs.readdirSync(reportsDir)) {
    if (!entry.endsWith(".html")) continue;
    const filePath = path.join(reportsDir, entry);
    let html: string;
    try {
      html = fs.readFileSync(filePath, "utf8");
    } catch {
      continue; // 文件被并发删除/不可读时跳过
    }
    const id = entry.replace(/\.html$/i, "");
    const before = getReport(id);
    registerReport(entry, html);
    if (!before) added += 1;
  }
  return added;
}
