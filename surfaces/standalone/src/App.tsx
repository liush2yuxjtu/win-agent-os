import { Component, useEffect, useState, type ReactNode } from "react";
import type { MessageStreamEvent } from "eve/client";
import {
  EveChatPlugin,
  normalChatPlugin,
  type ChatHistoryAdapter,
  type ChatHistoryEntry,
  type NavigationAdapter,
} from "@chat-surface-ui/core";

const DEFAULT_AGENT_ORIGIN = "http://127.0.0.1:2000";
const HISTORY_KEY = "standalone:chat-history:v1";
const MESSAGES_PREFIX = "standalone:chat-messages:v1:";

function getAgentOrigin(): string {
  const fromEnv = (import.meta.env.VITE_EVE_AGENT_ORIGIN as string | undefined)?.trim();
  return fromEnv || DEFAULT_AGENT_ORIGIN;
}

function isFixtureMode(): boolean {
  return new URLSearchParams(window.location.search).get("fixture") === "1";
}

// ── fixture 加载 ────────────────────────────────────────────────────────────
// 逐行 JSON.parse（NDJSON），只做「能安全交给 reducer」的结构校验：
// 每行必须是带 string type 和 data 字段的 JSON 对象。事件名是否属于当前
// eve 协议由 eve 的 reducer 兜底（未知事件类型直接忽略），不会白屏；
// 若结构非法则抛出可读错误，由 ErrorPanel 显示。
async function loadFixtureEvents(): Promise<MessageStreamEvent[]> {
  const res = await fetch(
    `${import.meta.env.BASE_URL}src/fixtures/session-events.ndjson`,
  );
  if (!res.ok) {
    throw new Error(`fixture 请求失败：HTTP ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("fixture 文件为空，没有任何事件。");
  }
  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`fixture 第 ${index + 1} 行不是合法 JSON。`);
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`fixture 第 ${index + 1} 行不是 JSON 对象。`);
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.type !== "string" || record.type.length === 0) {
      throw new Error(`fixture 第 ${index + 1} 行缺少字符串 type 字段。`);
    }
    if (!("data" in record)) {
      throw new Error(`fixture 第 ${index + 1} 行缺少 data 字段。`);
    }
    return parsed as MessageStreamEvent;
  });
}

// ── localStorage history adapter ────────────────────────────────────────────
function readHistoryEntries(): ChatHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeHistoryEntries(entries: ChatHistoryEntry[]): void {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
}

const localStorageHistory: ChatHistoryAdapter = {
  async list() {
    return readHistoryEntries();
  },
  record(session, meta) {
    const entries = readHistoryEntries();
    const next: ChatHistoryEntry = {
      sessionId: session.sessionId,
      streamIndex: session.streamIndex,
      title: meta.title,
      lastAt: Date.now(),
      userMessages: meta.userMessages,
    };
    const index = entries.findIndex((e) => e.sessionId === session.sessionId);
    if (index >= 0) entries[index] = next;
    else entries.unshift(next);
    writeHistoryEntries(entries.slice(0, 50));
  },
  syncMessages(sessionId, messages) {
    try {
      window.localStorage.setItem(
        `${MESSAGES_PREFIX}${sessionId}`,
        JSON.stringify(messages),
      );
    } catch {
      // localStorage 满/不可用时忽略，不阻塞聊天。
    }
  },
  async remove(sessionId) {
    writeHistoryEntries(
      readHistoryEntries().filter((e) => e.sessionId !== sessionId),
    );
    window.localStorage.removeItem(`${MESSAGES_PREFIX}${sessionId}`);
  },
  clear() {
    for (const entry of readHistoryEntries()) {
      window.localStorage.removeItem(`${MESSAGES_PREFIX}${entry.sessionId}`);
    }
    writeHistoryEntries([]);
  },
  async fetchSnapshot(_sessionId) {
    // 本地缓存只存消息快照，无法还原 eve 事件流；返回 null 走「全新会话」。
    return null;
  },
};

// ── navigation adapter：把会话深链映射到 ?session= 查询参数 ─────────────────
function sessionParamFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.startsWith("/chat/")) {
      return decodeURIComponent(parsed.pathname.slice("/chat/".length));
    }
    return null;
  } catch {
    return null;
  }
}

function applySessionParam(
  sessionId: string | null,
  mode: "push" | "replace",
): void {
  const params = new URLSearchParams(window.location.search);
  if (sessionId) params.set("session", sessionId);
  else params.delete("session");
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

const queryParamNavigation: NavigationAdapter = {
  push(url) {
    applySessionParam(sessionParamFromUrl(url), "push");
  },
  replace(url) {
    applySessionParam(sessionParamFromUrl(url), "replace");
  },
  openChat(sessionId) {
    applySessionParam(sessionId ?? null, "push");
  },
};

// ── 错误边界：fixture 不合法或插件渲染抛错时显示可读错误，避免白屏 ─────────
class ChatErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly error?: Error }
> {
  constructor(props: { readonly children: ReactNode }) {
    super(props);
    this.state = {};
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[standalone] EveChatPlugin 渲染失败", error);
  }

  render() {
    if (this.state.error) {
      return <ErrorPanel message={this.state.error.message} />;
    }
    return this.props.children;
  }
}

function ErrorPanel({ message }: { readonly message: string }) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-8">
      <div className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
        <div className="mb-2 flex items-center gap-2 font-semibold text-red-100">
          <span className="size-2 rounded-full bg-red-400" />
          fixture 回放失败
        </div>
        <p className="font-mono text-xs leading-relaxed text-red-200/90">
          {message}
        </p>
      </div>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-8 text-sm text-slate-400">
      正在加载 fixture…
    </div>
  );
}

export function App() {
  const agentOrigin = getAgentOrigin();
  const fixtureMode = isFixtureMode();
  const [fixtureEvents, setFixtureEvents] = useState<MessageStreamEvent[]>();
  const [fixtureError, setFixtureError] = useState<string>();

  useEffect(() => {
    if (!fixtureMode) {
      setFixtureEvents(undefined);
      setFixtureError(undefined);
      return;
    }
    let cancelled = false;
    loadFixtureEvents()
      .then((events) => {
        if (!cancelled) {
          setFixtureEvents(events);
          setFixtureError(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFixtureEvents(undefined);
          setFixtureError(
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fixtureMode]);

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-[#0b0e14] text-slate-100">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/8 px-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="size-2 rounded-full bg-emerald-400" />
          <span className="font-medium">@chat-surface-ui/core · standalone</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>
            agent origin:{" "}
            <code className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-slate-200">
              {agentOrigin}
            </code>
          </span>
          <span
            className={
              fixtureMode
                ? "rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-medium text-amber-200"
                : "rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300"
            }
          >
            {fixtureMode ? "fixture 回放" : "实时 /eve/v1"}
          </span>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="h-full max-h-[840px] w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#fbfaf6] shadow-[0_24px_80px_rgba(0,0,0,.45)]">
          {fixtureMode ? (
            fixtureError ? (
              <ErrorPanel message={fixtureError} />
            ) : !fixtureEvents ? (
              <LoadingPanel />
            ) : (
              <ChatErrorBoundary key={fixtureEvents.length}>
                <EveChatPlugin
                  host=""
                  profile="standalone"
                  standalone
                  adapters={{
                    history: localStorageHistory,
                    navigation: queryParamNavigation,
                    skills: [],
                  }}
                  plugins={[normalChatPlugin]}
                  initialEvents={fixtureEvents}
                  baseSuggestions={[
                    "回放消息已就绪",
                    "这是 fixture 事件流，不会请求真实 LLM",
                  ]}
                />
              </ChatErrorBoundary>
            )
          ) : (
            <EveChatPlugin
              host=""
              profile="standalone"
              standalone
              adapters={{
                history: localStorageHistory,
                navigation: queryParamNavigation,
                skills: [],
              }}
              plugins={[normalChatPlugin]}
            />
          )}
        </div>
      </section>
    </main>
  );
}
