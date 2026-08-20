/**
 * Read-only SQL Server query service.
 *
 * Guarantees:
 *  - Only SELECT / WITH (CTE) statements are accepted.
 *  - Row count is capped via SET ROWCOUNT so a runaway query can never return
 *    unbounded rows.
 *  - Sensitive columns (password/token/secret/keys) are auto-redacted.
 *  - Errors are returned as actionable messages, never raw stack traces.
 */
import sql from "mssql";
import type { DatabaseName } from "../types.js";
import { loadDbConfig, DB_POOL_MAX, DB_POOL_MIN, DB_POOL_IDLE_MS } from "../constants.js";

export class QueryError extends Error {}

export interface QueryResult {
  database: DatabaseName;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  text: string;
}

/** Column names treated as sensitive and redacted in output. */
const SENSITIVE_COLUMN = /(password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|credential)/i;

/** Statement keywords that indicate writes / dangerous operations. */
const FORBIDDEN = /^\s*(insert|update|delete|drop|alter|create|truncate|merge|exec|execute|grant|revoke|backup|restore|shutdown|kill|reconfigure|dbcc|set|use|go)\b/i;
const FORBIDDEN_ANYWHERE = /(;\s*(insert|update|delete|drop|alter|truncate|exec|execute|create)\b)|(\binto\s+[#@a-z0-9_\[\].]+)/i;
const ALLOWED_LEAD = /^\s*(select|with)\b/i;

/** Strip SQL comments (block + line) and string literals for safety checks. */
function sanitizeForInspection(sqlText: string): string {
  let s = sqlText;
  // block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, " ");
  // string literals (single-quoted, including doubled '' escapes)
  s = s.replace(/'((?:''|[^'])*)'/g, " ");
  // N-prefixed literals
  s = s.replace(/N'((?:''|[^'])*)'/g, " ");
  // line comments
  s = s.replace(/--[^\r\n]*/g, " ");
  return s;
}

/** Validate a query is read-only. Throws QueryError with actionable message. */
export function assertReadOnly(sqlText: string): void {
  const cleaned = sanitizeForInspection(sqlText.trim());
  if (!cleaned.trim()) {
    throw new QueryError("查询为空。请输入 SELECT 语句。");
  }
  if (!ALLOWED_LEAD.test(cleaned)) {
    throw new QueryError(
      "仅允许只读查询：语句必须以 SELECT 或 WITH(CTE) 开头。如需写入请使用其它途径。",
    );
  }
  if (FORBIDDEN.test(cleaned)) {
    throw new QueryError("检测到被禁止的关键字（INSERT/UPDATE/DELETE/DDL/EXEC 等），仅允许只读 SELECT。");
  }
  if (FORBIDDEN_ANYWHERE.test(cleaned)) {
    throw new QueryError("语句中出现了写入类操作或 SELECT INTO，仅允许只读查询。");
  }
  // reject multiple statements (more than one top-level statement)
  const stmts = cleaned.split(";").filter((s) => s.trim().length > 0);
  if (stmts.length > 1) {
    throw new QueryError("只允许单条查询语句，请去掉多余的分号或语句。");
  }
}

const poolCache = new Map<string, sql.ConnectionPool>();
/** Dedupes concurrent getPool calls so a single pool is created+connected per database. */
const pendingPools = new Map<string, Promise<sql.ConnectionPool>>();

function poolConfig(database: DatabaseName): sql.config {
  const cfg = loadDbConfig();
  return {
    server: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database,
    options: {
      encrypt: cfg.encrypt,
      trustServerCertificate: cfg.trustServerCertificate,
      connectTimeout: cfg.connectTimeoutMs,
      requestTimeout: cfg.requestTimeoutMs,
      appName: "qc-mcp-server",
    },
    // Persistent pooled connections: min keeps one warm per DB, max covers up
    // to DB_POOL_MAX parallel MCP tool calls. Reusing the pool avoids a fresh
    // TCP/TLS login per query.
    pool: {
      max: DB_POOL_MAX,
      min: DB_POOL_MIN,
      idleTimeoutMillis: DB_POOL_IDLE_MS,
      acquireTimeoutMillis: 30_000,
    },
  };
}

async function createPool(database: DatabaseName): Promise<sql.ConnectionPool> {
  const pool = new sql.ConnectionPool(poolConfig(database));
  await pool.connect();
  return pool;
}

async function getPool(database: DatabaseName): Promise<sql.ConnectionPool> {
  const key = `${loadDbConfig().host}:${loadDbConfig().port}:${database}`;
  const cached = poolCache.get(key);
  if (cached && cached.connected) return cached;

  // Another concurrent call is already creating this pool — await it.
  const existing = pendingPools.get(key);
  if (existing) return existing;

  const creating = createPool(database).then((pool) => {
    poolCache.set(key, pool);
    return pool;
  });
  pendingPools.set(key, creating);
  try {
    return await creating;
  } finally {
    pendingPools.delete(key);
  }
}

function redactValue(column: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (SENSITIVE_COLUMN.test(column)) return "[REDACTED]";
  return value;
}

/** Format a result set as a fixed-width aligned text table. */
function formatTable(columns: string[], rows: Record<string, unknown>[]): string {
  const headers = columns;
  const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
  const widths = headers.map((h, i) =>
    Math.max(
      h.length,
      ...rows.map((r) => String(r[headers[i]] ?? "NULL").length),
    ),
  );
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  const head = headers.map((h, i) => pad(h, widths[i])).join(" | ");
  const body = rows.map((r) =>
    headers.map((h, i) => pad(String(r[h] ?? "NULL"), widths[i])).join(" | "),
  );
  return [head, sep, ...body].join("\n");
}

/**
 * Execute a single read-only query against the given database and return
 * formatted text + structured rows. `maxRows` caps the result (default 100,
 * max 500).
 */
export async function runQuery(
  database: DatabaseName,
  queryText: string,
  maxRows = 100,
): Promise<QueryResult> {
  assertReadOnly(queryText);
  const cap = Math.max(1, Math.min(500, Math.floor(maxRows)));

  const pool = await getPool(database).catch((e: unknown) => {
    throw new QueryError(
      `无法连接数据库 ${database}：${e instanceof Error ? e.message : String(e)}。请检查 QC_MSSQL_* 配置或网络。`,
    );
  });

  const started = Date.now();
  let recordset: sql.IRecordSet<Record<string, unknown>>;
  try {
    const request = pool.request();
    // Cap rows at the session level so CTEs and subqueries are also bounded.
    request.multiple = false;
    const result = await request.query(
      `SET ROWCOUNT ${cap};\n${queryText};\nSET ROWCOUNT 0;`,
    );
    recordset = result.recordset ?? [];
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("login failed") || message.includes("Login failed")) {
      throw new QueryError(`数据库登录失败：请检查 QC_MSSQL_USER / QC_MSSQL_PASSWORD。`);
    }
    throw new QueryError(
      `SQL 执行失败：${message}\n请检查语法或用 QC_ 表文档确认字段名。`,
    );
  }

  const columns = recordset.length > 0 ? Object.keys(recordset[0]) : [];
  const rows = recordset.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of columns) out[c] = redactValue(c, r[c]);
    return out;
  });
  const truncated = rows.length >= cap;
  const durationMs = Date.now() - started;

  return {
    database,
    columns,
    rows,
    rowCount: rows.length,
    truncated,
    durationMs,
    text: formatTable(columns, rows),
  };
}

/** Clean up pools (used on shutdown). */
export async function closePools(): Promise<void> {
  await Promise.all([...poolCache.values()].map((p) => p.close().catch(() => {})));
  poolCache.clear();
}
