import type { EveMessage } from "eve/react";
import { Client, type SessionSnapshot } from "eve/client";

/**
 * 聊天历史记录层（双写）：
 *  - 服务端 SQLite（lib/chat-sessions/chat-sessions.db）——主存储，跨端口/浏览器一致；
 *  - 浏览器 localStorage（key qc.chat.history.v1）——离线/API 失败时的本地回退缓存。
 * 清单读取优先服务端 DB，失败回退本地缓存。
 */

const STORAGE_KEY = "qc.chat.history.v1";
/** 本地缓存保留的最近会话条数上限（服务端 DB 上限见 chat-sessions/db.ts）。 */
const MAX_ENTRIES = 30;

export type ChatHistoryEntry = {
  readonly sessionId: string;
  /** 上次已知的会话事件游标（恢复时用于 attach）。 */
  readonly streamIndex: number;
  /** 第一条用户消息的文本摘要。 */
  readonly title: string;
  /** 最后活跃时间（epoch ms）。 */
  readonly lastAt: number;
  /** 用户消息条数。 */
  readonly userMessages: number;
  /** 历史存档：服务端 eve session 已过期，仅 DB 文本记录（导入的旧会话）。 */
  readonly archived?: boolean;
};

function readStore(): ChatHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ChatHistoryEntry =>
        typeof e === "object" && e !== null &&
        typeof (e as ChatHistoryEntry).sessionId === "string" &&
        typeof (e as ChatHistoryEntry).title === "string",
    );
  } catch {
    return [];
  }
}

function writeStore(entries: ChatHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage 不可用（隐私模式/配额）时静默放弃记录，不阻塞聊天。
  }
}

/** 会话清单：优先服务端 DB（跨端口一致），失败回退本地缓存。 */
export async function listChatHistory(): Promise<ChatHistoryEntry[]> {
  try {
    const res = await fetch("/api/chat-sessions");
    if (res.ok) {
      const data = (await res.json()) as { sessions?: ChatHistoryEntry[] };
      if (Array.isArray(data.sessions)) return data.sessions;
    }
  } catch {
    // 服务端不可达，回退本地缓存
  }
  return readStore();
}

/** 记录/更新一次会话（双写：本地缓存 + 服务端 DB）。 */
export function recordChatSession(
  session: { readonly sessionId: string; readonly streamIndex: number },
  meta: { readonly title: string; readonly userMessages: number },
): void {
  const now = Date.now();
  const entries = readStore();
  const next = [
    {
      sessionId: session.sessionId,
      streamIndex: session.streamIndex,
      title: meta.title,
      lastAt: now,
      userMessages: meta.userMessages,
    },
    ...entries.filter((e) => e.sessionId !== session.sessionId),
  ].slice(0, MAX_ENTRIES);
  writeStore(next);
  void fetch("/api/chat-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: session.sessionId,
      streamIndex: session.streamIndex,
      title: meta.title,
      lastAt: now,
      userMessages: meta.userMessages,
    }),
  }).catch(() => {
    // 服务端落库失败不阻塞聊天（本地缓存仍在）
  });
}

/**
 * 同步会话消息本体到服务端 DB（幂等：seq 去重，重复同步不产生重复行）。
 * 单条内容超 200KB 截断，避免单条巨型工具输出撑爆数据库。
 */
export function syncChatMessages(sessionId: string, messages: readonly EveMessage[]): void {
  const payload = messages.map((message, seq) => {
    const toolName = message.parts.find((part) => part.type === "dynamic-tool" && "toolName" in part)
      ?.toolName as string | undefined;
    let content = JSON.stringify(message.parts);
    if (content.length > 200_000) content = content.slice(0, 200_000);
    return { seq, role: message.role, content, toolName };
  });
  if (payload.length === 0) return;
  void fetch("/api/chat-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, messages: payload }),
  }).catch(() => {
    // 消息同步失败不阻塞聊天
  });
}

export async function removeChatSession(sessionId: string): Promise<void> {
  writeStore(readStore().filter((e) => e.sessionId !== sessionId));
  try {
    await fetch(`/api/chat-sessions?sessionId=${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  } catch {
    // 服务端删除失败不阻塞
  }
}

/** 清空全部本地会话记录（不影响服务端持久化数据）。 */
export function clearChatHistory(): void {
  writeStore([]);
  void fetch("/api/chat-sessions?all=1", { method: "DELETE" }).catch(() => {});
}

/**
 * 从 eve 运行时重放一个会话的完整历史。
 * attach 后 snapshot() 会从事件 0 读到持久化尾部，返回 events + 精确游标 ——
 * 这两者正是 useEveAgent({ initialEvents, initialSession }) 恢复会话所需的全部输入。
 * 会话不存在或已过期（服务端 404/流错误）时返回 null。
 */
export async function fetchSessionSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
  try {
    const client = new Client({ host: "" });
    const session = client.sessions.attach(sessionId, { streamIndex: 0 });
    return await session.snapshot();
  } catch {
    return null;
  }
}
