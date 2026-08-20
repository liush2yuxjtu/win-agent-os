/**
 * 机器人绑定表（SQLite，node:sqlite 零依赖）。
 *
 * 现场绑定流：专家在 webapp 填 bot id+secret（企业微信）或扫码（微信）
 * → 写入本表 → 重启服务后 channel 启动时读表构造 adapter（Chat SDK
 * 的 adapter 集合构造时固定，无运行时热注册，故绑定后需重启生效）。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAgentPaths } from "../../../../platform";
import type { BotBinding, BotBindingView, BotConnectionStatus, BotPlatform, BotSession, BotStatus } from "./types";

export function bindingsDbPath(): string {
  return getAgentPaths().botBindingsDbPath;
}

export function openBindingsDb(): DatabaseSync {
  const dbPath = getAgentPaths().botBindingsDbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  // relay 每次消息都会短暂开连接 touch，多连接并发写需要 busy 等待
  db.exec(`PRAGMA busy_timeout = 2000;`);
  // bot_sessions 版本迁移：旧版主键 thread_id（一个用户所有 bot 共享会话）→
  // 新版主键 session_key = `${botKey}:${threadId}`（同一用户在不同 bot 各自独立会话）。
  // 旧行迁移为 bot_key='legacy' 保留原上下文。
  const sessionColumns = new Set(
    (db.prepare("PRAGMA table_info(bot_sessions)").all() as { name: string }[]).map((c) => c.name),
  );
  if (sessionColumns.size > 0 && !sessionColumns.has("session_key")) {
    db.exec(`
      ALTER TABLE bot_sessions RENAME TO bot_sessions_legacy;
      CREATE TABLE bot_sessions (
        session_key TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        thread_id   TEXT NOT NULL,
        bot_key     TEXT NOT NULL,
        platform    TEXT,
        binding_id  INTEGER,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      INSERT INTO bot_sessions (session_key, session_id, thread_id, bot_key, platform, binding_id, created_at, updated_at)
        SELECT 'legacy:' || thread_id, session_id, thread_id, 'legacy', platform, binding_id, created_at, updated_at
        FROM bot_sessions_legacy;
      DROP TABLE bot_sessions_legacy;
    `);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      session_key TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      thread_id   TEXT NOT NULL,
      bot_key     TEXT NOT NULL,
      platform    TEXT,
      binding_id  INTEGER,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_bindings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      platform    TEXT NOT NULL CHECK (platform IN ('wechat', 'wecom')),
      name        TEXT NOT NULL,
      owner       TEXT,
      status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'disabled')),
      bot_id      TEXT,
      secret      TEXT,
      account_dir TEXT,
      connection_status TEXT NOT NULL DEFAULT 'pending' CHECK (connection_status IN ('pending', 'connected', 'failed')),
      connected_at TEXT,
      last_active_at TEXT,
      connected_info TEXT,
      allowed_users TEXT,
      last_thread_id TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    -- 跨进程轮询互斥：同一 bot_key 同时只允许一个 poller 存活
    -- （冷启动 channel 在 eve dev server 进程、热绑定在 next-server 进程，
    -- 各自 globalThis 的防重互不可见，必须落库互斥，否则双 poller 双回复）
    CREATE TABLE IF NOT EXISTS bot_pollers (
      bot_key      TEXT PRIMARY KEY,
      pid          INTEGER NOT NULL,
      heartbeat_at TEXT NOT NULL,
      started_at   TEXT NOT NULL
    );
  `);
  // 轻量迁移：旧库补充新列（ALTER TABLE ADD COLUMN）
  const columns = new Set((db.prepare("PRAGMA table_info(bot_bindings)").all() as { name: string }[]).map((c) => c.name));
  if (!columns.has("connection_status")) {
    db.exec(`ALTER TABLE bot_bindings ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'pending'`);
  }
  if (!columns.has("connected_at")) db.exec("ALTER TABLE bot_bindings ADD COLUMN connected_at TEXT");
  if (!columns.has("last_active_at")) db.exec("ALTER TABLE bot_bindings ADD COLUMN last_active_at TEXT");
  if (!columns.has("connected_info")) db.exec("ALTER TABLE bot_bindings ADD COLUMN connected_info TEXT");
  if (!columns.has("allowed_users")) db.exec("ALTER TABLE bot_bindings ADD COLUMN allowed_users TEXT");
  if (!columns.has("last_thread_id")) db.exec("ALTER TABLE bot_bindings ADD COLUMN last_thread_id TEXT");
  return db;
}

function rowToBinding(row: Record<string, unknown>): BotBinding {
  return {
    id: Number(row.id),
    platform: row.platform as BotPlatform,
    name: String(row.name),
    owner: row.owner != null ? String(row.owner) : undefined,
    status: row.status as BotStatus,
    botId: row.bot_id != null ? String(row.bot_id) : undefined,
    secret: row.secret != null ? String(row.secret) : undefined,
    accountDir: row.account_dir != null ? String(row.account_dir) : undefined,
    connectionStatus: (row.connection_status ?? "pending") as BotConnectionStatus,
    connectedAt: row.connected_at != null ? String(row.connected_at) : undefined,
    lastActiveAt: row.last_active_at != null ? String(row.last_active_at) : undefined,
    connectedInfo: row.connected_info != null ? (JSON.parse(String(row.connected_info)) as Record<string, unknown>) : undefined,
    allowedUsers: row.allowed_users != null ? (JSON.parse(String(row.allowed_users)) as string[]) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listBindings(platform?: BotPlatform): BotBinding[] {
  const db = openBindingsDb();
  const rows = platform
    ? (db.prepare("SELECT * FROM bot_bindings WHERE platform = ? ORDER BY id").all(platform) as Record<string, unknown>[])
    : (db.prepare("SELECT * FROM bot_bindings ORDER BY id").all() as Record<string, unknown>[]);
  db.close();
  return rows.map(rowToBinding);
}

/** 当前生效的绑定（active 状态），供 channel 启动时构造 adapter。 */
export function getActiveBindings(platform: BotPlatform): BotBinding[] {
  const db = openBindingsDb();
  const rows = db
    .prepare("SELECT * FROM bot_bindings WHERE platform = ? AND status = 'active' ORDER BY id")
    .all(platform) as Record<string, unknown>[];
  db.close();
  return rows.map(rowToBinding);
}

export function upsertBinding(input: {
  platform: BotPlatform;
  name: string;
  owner?: string;
  status?: BotStatus;
  botId?: string;
  secret?: string;
  accountDir?: string;
  /** 允许对话的用户 ID 白名单；undefined = 更新时保留原值（插入时为 null），[] = 清空放开所有人。 */
  allowedUsers?: string[];
  id?: number;
}): BotBinding {
  const db = openBindingsDb();
  const now = new Date().toISOString();
  const allowedUsersJson = input.allowedUsers != null ? JSON.stringify(input.allowedUsers) : null;
  if (input.id != null) {
    // 更新时 allowed_users 用 COALESCE：不传（null）保留原值，避免编辑其他字段误清空白名单
    db.prepare(
      `UPDATE bot_bindings SET name = ?, owner = ?, status = ?, bot_id = ?, secret = ?, account_dir = ?,
       allowed_users = COALESCE(?, allowed_users), updated_at = ? WHERE id = ?`,
    ).run(input.name, input.owner ?? null, input.status ?? "active", input.botId ?? null, input.secret ?? null, input.accountDir ?? null, allowedUsersJson, now, input.id);
  } else {
    db.prepare(
      `INSERT INTO bot_bindings (platform, name, owner, status, bot_id, secret, account_dir, allowed_users, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(input.platform, input.name, input.owner ?? null, input.status ?? "active", input.botId ?? null, input.secret ?? null, input.accountDir ?? null, allowedUsersJson, now, now);
  }
  // UPDATE 后 last_insert_rowid() 不是目标行（本连接可能从未 INSERT），用 input.id 精确查回
  const row = input.id != null
    ? (db.prepare("SELECT * FROM bot_bindings WHERE id = ?").get(input.id) as Record<string, unknown> | undefined)
    : (db.prepare("SELECT * FROM bot_bindings WHERE id = last_insert_rowid()").get() as Record<string, unknown> | undefined);
  db.close();
  if (row == null) throw new Error(`upsertBinding 后未找到绑定行（id=${String(input.id)}）`);
  return rowToBinding(row);
}

/** 回写实际连接状态（channel 启动/连接成功/失败时调用）。 */
export function updateConnection(
  id: number,
  input: { status: BotConnectionStatus; connectedInfo?: Record<string, unknown> },
): void {
  const db = openBindingsDb();
  const now = new Date().toISOString();
  const connectedAt = input.status === "connected" ? now : null;
  db.prepare(
    `UPDATE bot_bindings SET connection_status = ?, connected_info = ?, connected_at = COALESCE(connected_at, ?), updated_at = ? WHERE id = ?`,
  ).run(input.status, input.connectedInfo != null ? JSON.stringify(input.connectedInfo) : null, connectedAt, now, id);
  db.close();
}

/** 回写最后活跃时间（收到消息时调用，节流到分钟级）。 */
export function touchActivity(id: number): void {
  const db = openBindingsDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE bot_bindings SET last_active_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
  db.close();
}

/** 记录最近会话线程（定时主动推送用 target 定位）。 */
export function setLastThread(id: number, threadId: string): void {
  const db = openBindingsDb();
  db.prepare(`UPDATE bot_bindings SET last_thread_id = ?, updated_at = ? WHERE id = ?`).run(threadId, new Date().toISOString(), id);
  db.close();
}

/** 按 adapter key（wechat:bot_7 / wecom:bot_7）解析绑定 id；匹配不到返回 null。 */
export function findBindingIdByAdapterKey(key: string): number | null {
  const match = key.match(/^(wechat|wecom):bot_(\d+)$/);
  if (!match) return null;
  return Number(match[2]);
}

/** 按 id 查单个绑定；不存在返回 undefined。 */
export function getBindingById(id: number): BotBinding | undefined {
  const db = openBindingsDb();
  const row = db.prepare("SELECT * FROM bot_bindings WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  db.close();
  return row != null ? rowToBinding(row) : undefined;
}

/** 白名单检查：绑定未配置 allowedUsers（或为空数组）时放行；配置后仅允许列出的用户 ID。 */
export function isUserAllowed(binding: BotBinding, userId: string): boolean {
  const allowed = binding.allowedUsers;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(userId);
}

/** 更新白名单（[] = 清空放开所有人）。relay 消息进来时实时检查，写入即生效。 */
export function setAllowedUsers(id: number, users: string[]): void {
  const db = openBindingsDb();
  db.prepare("UPDATE bot_bindings SET allowed_users = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(users),
    new Date().toISOString(),
    id,
  );
  db.close();
}

export function setBindingStatus(id: number, status: BotStatus): void {
  const db = openBindingsDb();
  db.prepare("UPDATE bot_bindings SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), id);
  db.close();
}

export function deleteBinding(id: number): void {
  const db = openBindingsDb();
  db.prepare("DELETE FROM bot_bindings WHERE id = ?").run(id);
  db.close();
}

/** 对外视图（secret 掩码）。 */
export function toView(binding: BotBinding): BotBindingView {
  return {
    id: binding.id,
    platform: binding.platform,
    name: binding.name,
    owner: binding.owner,
    status: binding.status,
    configured: binding.platform === "wecom" ? Boolean(binding.botId && binding.secret) : Boolean(binding.accountDir),
    connectionStatus: binding.connectionStatus,
    connectedAt: binding.connectedAt,
    lastActiveAt: binding.lastActiveAt,
    connectedInfo: binding.connectedInfo,
    allowedUsers: binding.allowedUsers,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

export function listBindingViews(platform?: BotPlatform): BotBindingView[] {
  return listBindings(platform).map(toView);
}

/* ------------------------------------------------------------------ */
/* bot_sessions：bot 会话 → eve sessionId 持久化（重启不丢）              */
/* session_key = `${botKey}:${threadId}`：同一用户在不同 bot 各自独立    */
/* 会话（botKey 形如 wechat:bot_7 / wecom:bot_6 / wechat:env）。         */
/* ------------------------------------------------------------------ */

/** 组装会话 key：botKey 与 threadId 均不含冒号分隔符（botKey 为 wechat:bot_N / wechat:env）。 */
export function sessionKeyFor(botKey: string, threadId: string): string {
  return `${botKey}:${threadId}`;
}

function rowToSession(row: Record<string, unknown>): BotSession {
  return {
    sessionKey: String(row.session_key),
    threadId: String(row.thread_id),
    sessionId: String(row.session_id),
    botKey: String(row.bot_key),
    platform: row.platform != null ? (row.platform as BotPlatform) : undefined,
    bindingId: row.binding_id != null ? Number(row.binding_id) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** 读取会话映射；不存在返回 null。 */
export function getSession(sessionKey: string): BotSession | null {
  const db = openBindingsDb();
  const row = db.prepare("SELECT * FROM bot_sessions WHERE session_key = ?").get(sessionKey) as
    | Record<string, unknown>
    | undefined;
  db.close();
  return row ? rowToSession(row) : null;
}

/** 写入/覆盖会话映射（upsert）。 */
export function setSession(
  botKey: string,
  threadId: string,
  sessionId: string,
  opts: { platform?: BotPlatform; bindingId?: number } = {},
): void {
  const db = openBindingsDb();
  const now = new Date().toISOString();
  const sessionKey = sessionKeyFor(botKey, threadId);
  db.prepare(
    `INSERT INTO bot_sessions (session_key, session_id, thread_id, bot_key, platform, binding_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_key) DO UPDATE SET
       session_id  = excluded.session_id,
       platform    = COALESCE(excluded.platform, bot_sessions.platform),
       binding_id  = COALESCE(excluded.binding_id, bot_sessions.binding_id),
       updated_at  = excluded.updated_at`,
  ).run(sessionKey, sessionId, threadId, botKey, opts.platform ?? null, opts.bindingId ?? null, now, now);
  db.close();
}

/** 刷新最后活跃时间（relay 每次命中会话时调用）。 */
export function touchSession(sessionKey: string): void {
  const db = openBindingsDb();
  db.prepare("UPDATE bot_sessions SET updated_at = ? WHERE session_key = ?").run(
    new Date().toISOString(),
    sessionKey,
  );
  db.close();
}

export function deleteSession(sessionKey: string): void {
  const db = openBindingsDb();
  db.prepare("DELETE FROM bot_sessions WHERE session_key = ?").run(sessionKey);
  db.close();
}

/** 清理超过 maxAgeDays 天无活跃的会话记录（updated_at < 截止时间），返回删除条数。 */
export function cleanupStaleSessions(maxAgeDays = 7): number {
  const db = openBindingsDb();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare("DELETE FROM bot_sessions WHERE updated_at < ?").run(cutoff);
  db.close();
  return Number(result.changes);
}

/** 当前持久化的会话映射总数（管理/测试用）。 */
export function countSessions(): number {
  const db = openBindingsDb();
  const row = db.prepare("SELECT COUNT(*) AS n FROM bot_sessions").get() as { n: number };
  db.close();
  return Number(row.n);
}

/* ------------------------------------------------------------------ */
/* bot_pollers：跨进程轮询互斥（防同一 bot 多 poller 抢消息导致双回复）    */
/*                                                                      */
/* 背景：冷启动 channel（agent/channels/*）在 eve dev server 进程启动，   */
/* 热绑定（hot-runtime）在 next-server 进程启动，两者各自的 globalThis    */
/* 防重互不可见，同 bot 会出现两个 poller。bot_pollers 用 SQLite 落库     */
/* 互斥：启动轮询前 claimPoller 抢占，被其他存活进程占用则跳过。           */
/* ------------------------------------------------------------------ */

/** 心跳超过该时长未刷新视为 poller 死亡，其他进程可接管。 */
export const POLLER_HEARTBEAT_TTL_MS = 3 * 60 * 1000;

/** pid 是否存活（同机部署用 process.kill(pid, 0) 探测；跨机部署需换共享心跳）。 */
function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 抢占 bot_key 的轮询权。
 * - 无记录 → 插入并占用
 * - 已有记录且占用者存活、心跳新鲜 → 返回 false（被其他进程 poller 占用）
 * - 占用者死亡 / 心跳过期 → 接管（UPDATE）
 * - 同 pid 重复 claim（eve dev 热重载重新执行模块）→ 更新心跳并放行
 * 库不可写（构建期评估等）时返回 false 并告警，调用方跳过轮询。
 */
export function claimPoller(botKey: string): boolean {
  const db = openBindingsDb();
  const now = new Date().toISOString();
  try {
    const row = db.prepare("SELECT pid, heartbeat_at FROM bot_pollers WHERE bot_key = ?").get(botKey) as
      | { pid: number; heartbeat_at: string }
      | undefined;
    if (row) {
      const heartbeatMs = new Date(row.heartbeat_at).getTime();
      const occupied = isProcessAlive(row.pid) && Date.now() - heartbeatMs < POLLER_HEARTBEAT_TTL_MS;
      if (occupied) return false;
      db.prepare("UPDATE bot_pollers SET pid = ?, heartbeat_at = ?, started_at = ? WHERE bot_key = ?").run(
        process.pid,
        now,
        now,
        botKey,
      );
      return true;
    }
    db.prepare("INSERT INTO bot_pollers (bot_key, pid, heartbeat_at, started_at) VALUES (?, ?, ?, ?)").run(
      botKey,
      process.pid,
      now,
      now,
    );
    return true;
  } catch (error) {
    // 并发抢占时 PK 冲突 / 构建期库不可写：视为不可占用，避免双 poller
    console.error(`[bot_pollers] claimPoller(${botKey}) 失败:`, error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    db.close();
  }
}

/** 刷新心跳（poller 存活证明；仅更新自己占用的行）。 */
export function heartbeatPoller(botKey: string): void {
  try {
    const db = openBindingsDb();
    db.prepare("UPDATE bot_pollers SET heartbeat_at = ? WHERE bot_key = ? AND pid = ?").run(
      new Date().toISOString(),
      botKey,
      process.pid,
    );
    db.close();
  } catch (error) {
    console.error(`[bot_pollers] heartbeatPoller(${botKey}) 失败:`, error instanceof Error ? error.message : String(error));
  }
}

/** 释放轮询权（进程退出钩子 / 主动停轮询时调用；仅删除自己占用的行）。 */
export function releasePoller(botKey: string): void {
  try {
    const db = openBindingsDb();
    db.prepare("DELETE FROM bot_pollers WHERE bot_key = ? AND pid = ?").run(botKey, process.pid);
    db.close();
  } catch (error) {
    console.error(`[bot_pollers] releasePoller(${botKey}) 失败:`, error instanceof Error ? error.message : String(error));
  }
}

/** 当前占用中的 poller 列表（管理/调试用）。 */
export function listPollers(): Array<{ botKey: string; pid: number; heartbeatAt: string; startedAt: string }> {
  const db = openBindingsDb();
  const rows = db.prepare("SELECT * FROM bot_pollers").all() as Record<string, unknown>[];
  db.close();
  return rows.map((r) => ({
    botKey: String(r.bot_key),
    pid: Number(r.pid),
    heartbeatAt: String(r.heartbeat_at),
    startedAt: String(r.started_at),
  }));
}
