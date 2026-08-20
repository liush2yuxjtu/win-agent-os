"use client";

import type { UseEveAgentOptions, EveMessageData } from "eve/react";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { noopHistoryAdapter } from "../adapters/defaults";
import type { ChatHistoryAdapter, ChatHistoryEntry } from "../adapters/history";
import type { NavigationAdapter } from "../adapters/navigation";
import type { SkillDescriptor } from "../adapters/skills";
import { ChatRootContext } from "./chat-root-context";
import { EveChatProvider } from "./EveChatProvider";

type RestoreEvents = NonNullable<UseEveAgentOptions<EveMessageData>["initialEvents"]>;
type RestoreState = NonNullable<UseEveAgentOptions<EveMessageData>["initialSession"]>;
type BootState = {
  events: RestoreEvents;
  session: RestoreState | undefined;
} | null;

export type EveChatRootProps = {
  readonly children: ReactNode;
  /**
   * 深链目标会话（/chat/<sessionId> 打开时由 RSC 传入）：
   * 挂载后自动执行一次 restoreSession，恢复完成前 restoring=true。
   * 只作用于首次挂载 —— 用户后续切换/新建会话不受影响。
   */
  readonly initialEntry?: ChatHistoryEntry;
  /**
   * 独立页模式（/chat/<id>、/chat/new）：页面不包含看板布局，
   * 「应用到看板」无法就地广播（无订阅者），需跨页接力。
   */
  readonly standalone?: boolean;
  /**
   * 独立 surface 的会话回放入口：直接注入 eve 流事件前缀（fixture 回放）。
   * 与 initialEntry 的区别是它不经过 history.fetchSnapshot，只做本地水合。
   */
  readonly initialEvents?: UseEveAgentOptions<EveMessageData>["initialEvents"];
  readonly initialSession?: UseEveAgentOptions<EveMessageData>["initialSession"];
  /** eve 客户端 base URL（同源默认 ""；独立 surface 可传绝对 origin）。 */
  readonly host?: string;
  readonly adapters?: {
    readonly history?: ChatHistoryAdapter;
    readonly navigation?: NavigationAdapter;
    readonly skills?: readonly SkillDescriptor[];
  };
};

/**
 * 会话切换层：EveChatProvider 内部通过 useRef 只创建一次 eve store，
 * 切换会话必须用 key 强制 remount。恢复流程：
 * 点击历史会话 → history.fetchSnapshot 全量重放事件 → 存为 boot →
 * key +1 让 EveChatProvider 以 initialEvents + initialSession 重新挂载，
 * 历史消息直接水合显示，后续发送走同一 durable sessionId。
 */
export function EveChatRoot({
  children,
  initialEntry,
  initialEvents,
  initialSession,
  standalone = false,
  host,
  adapters = {},
}: EveChatRootProps) {
  const [sessionKey, setSessionKey] = useState(0);
  const [boot, setBoot] = useState<BootState>(() =>
    initialEvents
      ? { events: initialEvents, session: initialSession }
      : null,
  );
  const [restoring, setRestoring] = useState(false);
  const history = adapters.history ?? noopHistoryAdapter;

  const restoreSession = useCallback(
    async (entry: ChatHistoryEntry) => {
      setRestoring(true);
      try {
        const snapshot = await history.fetchSnapshot(entry.sessionId);
        if (snapshot) {
          // 重放成功：水合历史 + 绑定会话
          setBoot({ events: snapshot.events, session: snapshot.session });
        } else {
          // 会话在服务端已过期/丢失：保留清单记录（历史存档，DB 仍有文本），退化为全新会话
          setBoot(null);
        }
        setSessionKey((k) => k + 1);
      } finally {
        setRestoring(false);
      }
    },
    [history],
  );

  const startNewSession = useCallback(() => {
    setBoot(null);
    setSessionKey((k) => k + 1);
  }, []);

  // 深链首次挂载：自动恢复目标会话（restoreSession 内部处理过期 fallback）。
  useEffect(() => {
    if (initialEntry) {
      void restoreSession(initialEntry);
    }
    // 只在首挂执行一次；restoreSession 是稳定回调，不参与依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ChatRootContext.Provider value={{ restoreSession, startNewSession, restoring }}>
      <EveChatProvider
        key={sessionKey}
        initialEvents={boot?.events}
        initialSession={boot?.session}
        standalone={standalone}
        host={host}
        adapters={adapters}
      >
        {children}
      </EveChatProvider>
    </ChatRootContext.Provider>
  );
}

export const ChatRoot = EveChatRoot;
