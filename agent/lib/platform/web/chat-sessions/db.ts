/**
 * 聊天历史数据库（SQLite，node:sqlite 零依赖）。
 *
 * 目的：把网页聊天历史从浏览器 localStorage（per-origin、易丢）提升为
 * 服务端持久化 —— 跨端口、跨浏览器一致，会话清单不随 dev 重启丢失。
 *
 * 表结构：
 *  - chat_sessions：会话清单（sessionId 为主键，含恢复所需的事件游标）
 *  - chat_messages：消息本体（seq 为会话内序号，unique(session_id, seq)
 *    做幂等 —— 前端每次全量同步，重复 POST 不产生重复行）
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAgentPaths } from "../../../../platform";
import type { ChatHistoryEntryLite } from "../../../../platform";

/** 会话附加字段（含存档标记，导入的历史会话 archived=1）。 */
export type ChatSessionMeta = {
  /** 历史存档（服务端 eve session 已过期，仅文本记录可读）。 */
  archived?: boolean;
};

export function chatSessionsDbPath(): string {
  return getAgentPaths().chatSessionsDbPath;
}

export function openChatSessionsDb(): DatabaseSync {
  const dbPath = getAgentPaths().chatSessionsDbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA busy_timeout = 2000;
    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id    TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      stream_index  INTEGER NOT NULL DEFAULT 0,
      source        TEXT NOT NULL DEFAULT 'web',
      user_messages INTEGER NOT NULL DEFAULT 0,
      last_at       TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      archived      INTEGER NOT NULL DEFAULT 0
    );
  `);
  // 轻量迁移：旧库补 archived 列
  const columns = new Set(
    (db.prepare("PRAGMA table_info(chat_sessions)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!columns.has("archived")) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      seq        INTEGER NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      tool_name  TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(session_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
  `);
  return db;
}

/** 会话清单中保留的最大条数（超过裁掉最旧的，与服务端会话保留期对齐）。 */
const MAX_SESSIONS = 50;

function rowToEntry(row: Record<string, unknown>): ChatHistoryEntryLite {
  return {
    sessionId: String(row.session_id),
    streamIndex: Number(row.stream_index ?? 0),
    title: String(row.title),
    lastAt: Date.parse(String(row.last_at)),
    userMessages: Number(row.user_messages ?? 0),
    archived: Number(row.archived ?? 0) === 1,
  };
}

/** 写入/更新会话清单（按最后活跃时间倒序，超上限裁掉最旧）。 */
export function upsertChatSession(
  entry: Pick<ChatHistoryEntryLite, "sessionId" | "streamIndex" | "title" | "lastAt" | "userMessages">,
  source = "web",
  meta?: ChatSessionMeta,
): void {
  const db = openChatSessionsDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chat_sessions (session_id, title, stream_index, source, user_messages, last_at, created_at, updated_at, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       title = excluded.title,
       stream_index = excluded.stream_index,
       user_messages = excluded.user_messages,
       last_at = excluded.last_at,
       updated_at = excluded.updated_at`,
  ).run(
    entry.sessionId,
    entry.title,
    entry.streamIndex,
    source,
    entry.userMessages,
    new Date(entry.lastAt).toISOString(),
    now,
    now,
    meta?.archived ? 1 : 0,
  );
  // 裁剪超上限的旧会话（连带其消息）——按 source 分开裁，bot 会话不挤占网页额度
  const stale = db
    .prepare("SELECT session_id FROM chat_sessions WHERE source = ? ORDER BY last_at DESC LIMIT -1 OFFSET ?")
    .all(source, MAX_SESSIONS) as Record<string, unknown>[];
  for (const row of stale) {
    deleteChatSession(String(row.session_id));
  }
  db.close();
}

/**
 * 会话清单（按最后活跃倒序）。
 * source 过滤：默认 'web'（网页 chat 历史清单），'bot' 查 bot 会话，'all' 不过滤。
 */
export function listChatSessions(limit = MAX_SESSIONS, source: string | null = "web"): ChatHistoryEntryLite[] {
  const db = openChatSessionsDb();
  const rows =
    source && source !== "all"
      ? (db
          .prepare("SELECT * FROM chat_sessions WHERE source = ? ORDER BY last_at DESC LIMIT ?")
          .all(source, limit) as Record<string, unknown>[])
      : (db.prepare("SELECT * FROM chat_sessions ORDER BY last_at DESC LIMIT ?").all(limit) as Record<string, unknown>[]);
  db.close();
  return rows.map(rowToEntry);
}

/** 查询单个会话的清单信息（深链 /chat/<sessionId> 恢复用）。不存在返回 null。 */
export function getChatSession(sessionId: string): ChatHistoryEntryLite | null {
  const db = openChatSessionsDb();
  const row = db.prepare("SELECT * FROM chat_sessions WHERE session_id = ?").get(sessionId) as
    | Record<string, unknown>
    | undefined;
  db.close();
  return row ? rowToEntry(row) : null;
}

export interface StoredChatMessage {
  seq: number;
  role: string;
  content: string;
  toolName?: string;
  createdAt: string;
}

/** 会话的消息列表（按序号升序）。 */
export function listChatMessages(sessionId: string, limit = 1000): StoredChatMessage[] {
  const db = openChatSessionsDb();
  const rows = db
    .prepare("SELECT seq, role, content, tool_name, created_at FROM chat_messages WHERE session_id = ? ORDER BY seq LIMIT ?")
    .all(sessionId, limit) as Record<string, unknown>[];
  db.close();
  return rows.map((r) => ({
    seq: Number(r.seq),
    role: String(r.role),
    content: String(r.content),
    toolName: r.tool_name != null ? String(r.tool_name) : undefined,
    createdAt: String(r.created_at),
  }));
}

/**
 * 幂等追加消息：unique(session_id, seq)。
 * 同 seq 重复同步时**用新版覆盖旧版**（而非忽略）——流式期间同一位置的
 * 消息可能先同步到「片段版」（断线重连 / watchdog cancel 等中途同步），
 * 若忽略，之后同步的「完整版」会因 seq 冲突被丢弃，db 永久残留残缺内容
 * （表现为最终回复缺失、同一条回复被拆成多条）。覆盖语义保证最终一致：
 * 后同步的完整版必然胜出。
 */
export function appendChatMessages(sessionId: string, messages: Array<Omit<StoredChatMessage, "createdAt">>): number {
  if (messages.length === 0) return 0;
  const db = openChatSessionsDb();
  const stmt = db.prepare(
    `INSERT INTO chat_messages (session_id, seq, role, content, tool_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, seq) DO UPDATE SET
       content = excluded.content,
       tool_name = excluded.tool_name,
       role = excluded.role`,
  );
  const now = new Date().toISOString();
  let inserted = 0;
  for (const m of messages) {
    inserted += Number(stmt.run(sessionId, m.seq, m.role, m.content, m.toolName ?? null, now).changes);
  }
  db.close();
  return inserted;
}

/** bot 会话 ID 组装：与网页会话（eve session id）隔离，bot 聊天记录独立查询。 */
export function botChatSessionId(botKey: string, conversationKey: string): string {
  return `bot:${botKey}:${conversationKey}`;
}

/** 会话标题：取会话键的用户标识段（截断防长），前缀区分平台。 */
function titleFromConversationKey(botKey: string, conversationKey: string): string {
  const tail = conversationKey.split(":").pop() ?? conversationKey;
  const prefix = botKey.startsWith("wecom") ? "企微" : "微信";
  const short = tail.length > 32 ? `${tail.slice(0, 32)}…` : tail;
  return `${prefix} ${short}`;
}

/**
 * bot 聊天记录落库（source='bot'）：用户消息与 bot 回复各记一条。
 *
 * - 会话键稳定：botKey + conversationId 用户段（同 relay 的会话映射），
 *   同用户同 bot 的消息归入同一会话，跨重启不丢。
 * - seq 自动取会话内 max+1：relay 的会话串行队列保证同会话落库不乱序。
 * - 幂等：unique(session_id, seq) 冲突时覆盖（同 seq 只留后写入的文本）。
 * - best-effort：任何失败只告警，不抛错 —— bot 消息转发不能因落库失败中断。
 */
export function recordBotMessage(opts: {
  botKey: string;
  conversationKey: string;
  role: "user" | "assistant";
  text: string;
}): void {
  try {
    const sessionId = botChatSessionId(opts.botKey, opts.conversationKey);
    const db = openChatSessionsDb();
    const now = new Date().toISOString();
    if (!db.prepare("SELECT session_id FROM chat_sessions WHERE session_id = ?").get(sessionId)) {
      db.prepare(
        `INSERT INTO chat_sessions (session_id, title, stream_index, source, user_messages, last_at, created_at, updated_at, archived)
         VALUES (?, ?, 0, 'bot', 0, ?, ?, ?, 0)`,
      ).run(sessionId, titleFromConversationKey(opts.botKey, opts.conversationKey), now, now, now);
    }
    const maxSeq = db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM chat_messages WHERE session_id = ?").get(sessionId) as {
      m: number;
    };
    const seq = Number(maxSeq.m) + 1;
    const current = db.prepare("SELECT user_messages FROM chat_sessions WHERE session_id = ?").get(sessionId) as {
      user_messages: number;
    };
    const userMessages = opts.role === "user" ? Number(current.user_messages) + 1 : Number(current.user_messages);
    db.prepare("UPDATE chat_sessions SET last_at = ?, updated_at = ?, user_messages = ? WHERE session_id = ?").run(
      now,
      now,
      userMessages,
      sessionId,
    );
    db.prepare(
      `INSERT INTO chat_messages (session_id, seq, role, content, tool_name, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)
       ON CONFLICT(session_id, seq) DO UPDATE SET content = excluded.content, role = excluded.role`,
    ).run(sessionId, seq, opts.role, opts.text, now);
    db.close();
  } catch (error) {
    console.error("[chat-sessions] bot 消息落库失败（忽略）:", error instanceof Error ? error.message : String(error));
  }
}

export function deleteChatSession(sessionId: string): void {
  const db = openChatSessionsDb();
  db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM chat_sessions WHERE session_id = ?").run(sessionId);
  db.close();
}

export function clearChatSessions(): void {
  const db = openChatSessionsDb();
  db.exec("DELETE FROM chat_messages; DELETE FROM chat_sessions;");
  db.close();
}
