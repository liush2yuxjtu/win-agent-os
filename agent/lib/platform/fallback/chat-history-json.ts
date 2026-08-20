/**
 * standalone/headless 的聊天历史降级实现（fs/JSON）。
 *
 * 与 web 的 SQLite HistoryStore 同接口（见 agent/platform.ts 的 HistoryStore）。
 * 文件布局：
 *   <repoRoot>/.eve/artifacts/chat-sessions.json        会话清单
 *   <repoRoot>/.eve/artifacts/chat-messages/<id>.jsonl  消息（每行一条）
 *
 * 原则：文件不存在时返回空列表/null，绝不抛错（不阻塞 agent 主流程）。
 */
import fs from "node:fs";
import path from "node:path";
import { getAgentPaths } from "../../../platform";
import type { ChatHistoryEntryLite, HistoryStore, StoredChatMessageLite } from "../../../platform";

const MAX_SESSIONS = 50;

interface JsonSession {
  sessionId: string;
  streamIndex: number;
  title: string;
  lastAt: number;
  userMessages: number;
  archived?: boolean;
  source?: string;
}

function indexPath(): string {
  return path.join(getAgentPaths().repoRoot, ".eve", "artifacts", "chat-sessions.json");
}

function messageDir(): string {
  return path.join(getAgentPaths().repoRoot, ".eve", "artifacts", "chat-messages");
}

function messagePath(sessionId: string): string {
  return path.join(messageDir(), `${encodeURIComponent(sessionId)}.jsonl`);
}

function readIndex(): JsonSession[] {
  try {
    const raw = fs.readFileSync(indexPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is JsonSession =>
        typeof e === "object" && e !== null && typeof (e as JsonSession).sessionId === "string",
    );
  } catch {
    return [];
  }
}

function writeIndex(entries: JsonSession[]): void {
  try {
    fs.mkdirSync(path.dirname(indexPath()), { recursive: true });
    fs.writeFileSync(indexPath(), JSON.stringify(entries, null, 2) + "\n", "utf8");
  } catch {
    // 降级实现：写失败不抛错
  }
}

function readMessages(sessionId: string): StoredChatMessageLite[] {
  try {
    const raw = fs.readFileSync(messagePath(sessionId), "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as StoredChatMessageLite);
  } catch {
    return [];
  }
}

function upsertSession(
  entry: Pick<ChatHistoryEntryLite, "sessionId" | "streamIndex" | "title" | "lastAt" | "userMessages">,
  source = "web",
  meta?: { archived?: boolean },
): void {
  const sessions = readIndex().filter((s) => s.sessionId !== entry.sessionId);
  sessions.unshift({
    sessionId: entry.sessionId,
    streamIndex: entry.streamIndex,
    title: entry.title,
    lastAt: entry.lastAt,
    userMessages: entry.userMessages,
    archived: meta?.archived === true,
    source,
  });
  writeIndex(sessions.slice(0, MAX_SESSIONS));
}

function titleFromConversationKey(botKey: string, conversationKey: string): string {
  const tail = conversationKey.split(":").pop() ?? conversationKey;
  const prefix = botKey.startsWith("wecom") ? "企微" : "微信";
  const short = tail.length > 32 ? `${tail.slice(0, 32)}…` : tail;
  return `${prefix} ${short}`;
}

export const HistoryStoreJson: HistoryStore = {
  chatSessionsDbPath(): string {
    return path.join(getAgentPaths().repoRoot, ".eve", "artifacts", "chat-sessions.db");
  },

  openChatSessionsDb(): null {
    return null;
  },

  upsertChatSession(entry, source = "web", meta) {
    upsertSession(entry, source, meta);
  },

  listChatSessions(limit = MAX_SESSIONS, source: string | null = "web"): ChatHistoryEntryLite[] {
    const all = readIndex();
    const filtered =
      source && source !== "all" ? all.filter((s) => (s.source ?? "web") === source) : all;
    return filtered.slice(0, limit);
  },

  getChatSession(sessionId: string): ChatHistoryEntryLite | null {
    return readIndex().find((s) => s.sessionId === sessionId) ?? null;
  },

  listChatMessages(sessionId: string, limit = 1000): StoredChatMessageLite[] {
    return readMessages(sessionId).slice(0, limit);
  },

  appendChatMessages(sessionId: string, messages): number {
    if (messages.length === 0) return 0;
    try {
      const now = new Date().toISOString();
      const rows = messages.map((m) => ({ ...m, createdAt: now }));
      fs.mkdirSync(messageDir(), { recursive: true });
      fs.appendFileSync(
        messagePath(sessionId),
        rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
        "utf8",
      );
      return rows.length;
    } catch {
      return 0;
    }
  },

  botChatSessionId(botKey: string, conversationKey: string): string {
    return `bot:${botKey}:${conversationKey}`;
  },

  recordBotMessage(opts): void {
    try {
      const sessionId = `bot:${opts.botKey}:${opts.conversationKey}`;
      const sessions = readIndex();
      const existing = sessions.find((s) => s.sessionId === sessionId);
      if (!existing) {
        sessions.unshift({
          sessionId,
          streamIndex: 0,
          title: titleFromConversationKey(opts.botKey, opts.conversationKey),
          lastAt: Date.now(),
          userMessages: opts.role === "user" ? 1 : 0,
          archived: false,
          source: "bot",
        });
      } else {
        existing.lastAt = Date.now();
        if (opts.role === "user") existing.userMessages += 1;
      }
      writeIndex(sessions.slice(0, MAX_SESSIONS));
      const existingMessages = readMessages(sessionId);
      const next = existingMessages.length + 1;
      fs.mkdirSync(messageDir(), { recursive: true });
      fs.appendFileSync(
        messagePath(sessionId),
        JSON.stringify({ seq: next, role: opts.role, content: opts.text, createdAt: new Date().toISOString() }) + "\n",
        "utf8",
      );
    } catch {
      // best-effort
    }
  },

  deleteChatSession(sessionId: string): void {
    try {
      fs.rmSync(messagePath(sessionId), { force: true });
      writeIndex(readIndex().filter((s) => s.sessionId !== sessionId));
    } catch {
      // ignore
    }
  },

  clearChatSessions(): void {
    try {
      fs.rmSync(messageDir(), { recursive: true, force: true });
      writeIndex([]);
    } catch {
      // ignore
    }
  },
};
