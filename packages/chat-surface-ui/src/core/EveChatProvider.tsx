"use client";

import type { UserContent } from "ai";
import {
  type EveMessage,
  type EveMessageData,
  type UseEveAgentHelpers,
  type UseEveAgentOptions,
  useEveAgent,
} from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultNavigationAdapter, noopHistoryAdapter } from "../adapters/defaults";
import type { ChatHistoryAdapter } from "../adapters/history";
import type { NavigationAdapter } from "../adapters/navigation";
import type { SkillDescriptor } from "../adapters/skills";
import type { PromptInputMessage } from "../ai-elements/prompt-input";
import { ChatContext, type ChatContextValue, type WorkspaceMode } from "./chat-context";
import { useChatRoot } from "./chat-root-context";
import { EveChatAdaptersContext } from "./contexts";

export type EveChatProviderProps = {
  readonly children: React.ReactNode;
  readonly initialEvents?: UseEveAgentOptions<EveMessageData>["initialEvents"];
  readonly initialSession?: UseEveAgentOptions<EveMessageData>["initialSession"];
  readonly standalone?: boolean;
  /** eve 客户端 base URL（同源默认 ""；独立 surface 可传绝对 origin）。 */
  readonly host?: string;
  /** 装配 adapters；不传则使用 no-op 默认。 */
  readonly adapters?: {
    readonly history?: ChatHistoryAdapter;
    readonly navigation?: NavigationAdapter;
    readonly skills?: readonly SkillDescriptor[];
  };
};

/**
 * EveChatProvider 接受可选 initialEvents / initialSession（来自 EveChatRoot
 * 的恢复流程）：store 首次创建时据此 attach 到既有 durable session 并水合
 * 历史消息。注意 useEveAgent 只在挂载时读取这些配置 —— 切换会话由
 * EveChatRoot 用 key remount 完成。
 */
export function EveChatProvider({
  children,
  initialEvents,
  initialSession,
  standalone = false,
  host,
  adapters = {},
}: EveChatProviderProps) {
  const [mode, setMode] = useState<WorkspaceMode>("dashboard");
  const [cancellationError, setCancellationError] = useState<string>();
  const [localGreeting, setLocalGreeting] = useState(false);
  const { restoreSession, startNewSession, restoring } = useChatRoot();
  const history = adapters.history ?? noopHistoryAdapter;
  const navigation = adapters.navigation ?? defaultNavigationAdapter;
  const agent = useEveAgent({ initialEvents, initialSession, host });

  // 会话推进时把会话 id / 游标 / 标题同步到历史清单（服务端 DB + 本地缓存），
  // 并把消息本体同步到服务端 DB（幂等，供跨端口恢复）。
  // 注意：streamIndex 每个流事件都递增（一个 turn 有几百个 reasoning/text delta
  // 事件），若每事件都全量同步消息，长对话会形成 fetch+SQLite 写风暴导致聊天
  // 卡死。因此：清单记录 1s 节流（小 payload，游标够新即可）；消息本体只在
  // turn 结束后同步一次。
  const sessionId = agent.session?.sessionId;
  const streamIndex = agent.session?.streamIndex;

  // 会话即地址：session 出现/切换后 URL 同步到 /chat/<sessionId>。
  // 覆盖所有入口 —— 新对话发首条消息（session 首次创建）、历史面板恢复、
  // 深链打开（URL 已一致则不动）。navigation.push 不触发重渲染，无循环风险；
  // 仅在值变化时写入，避免历史栈膨胀。新会话尚未创建（undefined）时
  // 不动 URL，由 ChatHistoryPanel 的「新建对话」显式回 "/"。
  useEffect(() => {
    if (!sessionId) return;
    const path = `/chat/${encodeURIComponent(sessionId)}`;

    if (typeof window !== "undefined" && window.location.pathname !== path) {
      navigation.push(path);
    }
  }, [sessionId, navigation]);

  const syncStateRef = useRef({ lastListAt: 0, lastStatus: "ready" });
  // 最新消息快照（供延迟同步读取）：turn 结束的 effect 里 agent.data.messages
  // 可能还是流式片段版（断线重连/watchdog 等边沿路径下 status 会先于最终文本
  // 变 ready/error），延迟一拍等文本落定，避免把片段版同步上去。
  const messagesRef = useRef<readonly EveMessage[]>([]);
  messagesRef.current = agent.data.messages;

  // 水合兜底同步：页面刷新/热重载会销毁旧 store，若那时 turn 已完成（服务端
  // 事件完整），「turn 结束同步」会永久丢失（前端无人再触发）。恢复/水合
  // （initialEvents 重放）完成后补一次全量同步，把完整快照兜进 db（UPSERT
  // 幂等覆盖，不产生重复）。全新会话 messages 为空，自然跳过。
  const hydratedSyncRef = useRef(false);
  useEffect(() => {
    if (hydratedSyncRef.current) return;
    const state = agent.session;
    if (!state || agent.data.messages.length === 0) return;
    hydratedSyncRef.current = true;
    setTimeout(() => {
      const latest = messagesRef.current;
      if (latest.length > 0) history.syncMessages(state.sessionId, latest);
    }, 300);
    // 注意：不要返回 cleanup —— effect 依赖 [agent] 每次渲染都重跑，
    // cleanup 会杀掉尚未触发的 timer；水合中途的渲染（attach 分批重放、
    // restoring 状态翻转）会反复重跑 effect，一旦 hydratedSyncRef 已置位，
    // 之后不再重设 timer，同步将永远不触发。timer 不清理最多让回调在
    // 组件卸载后空跑一次 fetch（幂等，无害）。
  }, [agent, history]);
  useEffect(() => {
    const state = agent.session;
    if (!state) return;
    const messages = agent.data.messages;
    const userMessages = messages.filter((m) => m.role === "user").length;
    const title = firstUserText(messages) ?? "新对话";

    const now = Date.now();
    if (now - syncStateRef.current.lastListAt >= 1_000) {
      syncStateRef.current.lastListAt = now;
      history.record(
        { sessionId: state.sessionId, streamIndex: state.streamIndex },
        { title, userMessages },
      );
    }

    const status = agent.status;
    const prevStatus = syncStateRef.current.lastStatus;
    syncStateRef.current.lastStatus = status;
    const turnEnded = status === "ready" || status === "error";
    if (messages.length > 0 && turnEnded && prevStatus !== status) {
      // 延迟一拍再同步：React 渲染闭包里的 messages 可能晚于 status 就绪
      // （最终文本事件与 status 落定不在同一渲染批），宏任务后读取 ref 里的
      // 最新快照，确保同步的是完整版而非流式中途的片段版。
      setTimeout(() => {
        const latest = messagesRef.current;
        if (latest.length > 0) history.syncMessages(state.sessionId, latest);
      }, 150);
    }
    // 只在会话身份或事件游标推进时记录（agent 对象每次渲染都是新引用，不能作为依赖）。
  }, [sessionId, streamIndex, agent.status, history]);

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;
  const hasConversation = !isEmpty || localGreeting;
  const errorMessage = cancellationError ?? agent.error?.message;

  // ── 流卡死 watchdog ─────────────────────────────────────────────
  // 后端 turn 已完成但前端 SSE 流断连（dev 热重载/网络抖动/半开连接）时，
  // status 会一直停在 streaming。eve client 有断线续传重连，但连接建立
  // 阶段的 fetch 无超时——半开连接会永久挂起。这里兜底：streaming 状态
  // 超过 STALL_MS 无任何新事件 → 自动 cancel（abort 流 → 状态回 ready），
  // 并提示用户重新发送。cancel 只中断等待，不丢已有消息。
  // 30s 无事件即触发恢复检查：先拉服务端快照（后端已完成则自动恢复显示，
  // 无需用户操作），快照无新事件才 cancel + 提示重发。
  const STALL_MS = 30_000;
  const lastEventAtRef = useRef(Date.now());
  useEffect(() => {
    lastEventAtRef.current = Date.now();
  }, [agent.events.length, agent.status]);
  useEffect(() => {
    if (agent.status !== "streaming") return;
    const timer = setInterval(() => {
      if (agent.status !== "streaming") {
        clearInterval(timer);
        return;
      }
      if (Date.now() - lastEventAtRef.current > STALL_MS) {
        // 断流 30s：先尝试从服务端恢复——后端 turn 可能已完成,只是 SSE 断连
        // (dev server 重启/网络抖动)。快照有新事件 → 恢复会话水合显示完整结果,
        // 不再让用户误以为卡住而重发;后端确实没进展才 cancel + 提示重发。
        const sid = agent.session?.sessionId;
        const knownEvents = agent.events.length;
        const fallback = () => {
          setCancellationError("连接似乎中断了（长时间无响应），已自动停止等待。请重新发送问题。");
          void agent.cancel().catch(() => {
            // cancel 失败不阻断；用户可手动重试
          });
        };
        if (!sid) {
          fallback();
          return;
        }
        void history
          .fetchSnapshot(sid)
          .then((snapshot) => {
            if (!snapshot || snapshot.events.length <= knownEvents) {
              fallback();
              return;
            }
            // 后端已推进（大概率已完成）：remount 水合完整事件流
            void restoreSession({
              sessionId: sid,
              streamIndex: snapshot.session.streamIndex,
              title: "恢复会话",
              lastAt: Date.now(),
              userMessages: 0,
            });
          })
          .catch(fallback);
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [agent, agent.status, history, restoreSession]);

  const requestCancellation = useCallback(() => {
    setCancellationError(undefined);
    void agent.cancel().catch((error: unknown) => {
      setCancellationError(error instanceof Error ? error.message : "无法取消当前请求。");
    });
  }, [agent]);

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      if ((text.length === 0 && message.files.length === 0) || isBusy) return;

      setCancellationError(undefined);

      if (message.files.length === 0) {
        if (text === "你好") {
          setLocalGreeting(true);
          return;
        }
        await agent.send(text);
        return;
      }

      const parts: UserContent = [];
      if (text.length > 0) parts.push({ text, type: "text" });
      for (const file of message.files) {
        parts.push({
          data: file.url,
          filename: file.filename,
          mediaType: file.mediaType,
          type: "file",
        });
      }
      await agent.send(parts);
    },
    [agent, isBusy],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      agent,
      mode,
      setMode,
      cancellationError,
      localGreeting,
      isBusy,
      isEmpty,
      hasConversation,
      errorMessage,
      requestCancellation,
      handleSubmit,
      restoreSession,
      startNewSession,
      restoring,
      isStandalone: standalone,
    }),
    [
      agent,
      mode,
      cancellationError,
      localGreeting,
      isBusy,
      isEmpty,
      hasConversation,
      errorMessage,
      requestCancellation,
      handleSubmit,
      restoreSession,
      startNewSession,
      restoring,
      standalone,
    ],
  );

  return (
    <EveChatAdaptersContext.Provider value={adapters}>
      <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
    </EveChatAdaptersContext.Provider>
  );
}

export const ChatProvider = EveChatProvider;

/** 取第一条用户消息的文本作为会话标题。 */
function firstUserText(messages: readonly EveMessage[]): string | undefined {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.parts.find((part) => part.type === "text");
    const content = text && "text" in text ? (text as { text: string }).text.trim() : "";
    if (content.length > 0) return content.slice(0, 30);
  }
  return undefined;
}
