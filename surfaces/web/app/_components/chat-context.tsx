"use client";

import { EveChatProvider, type EveChatProviderProps } from "@chat-surface-ui/core";
import { webHistoryAdapter, webSkills } from "./chat-web-adapters";

export type { WorkspaceMode } from "@chat-surface-ui/core";
export { useChatContext } from "@chat-surface-ui/core";

/**
 * 旧 ChatProvider 组件名的薄 wrapper：自动装配 web history/skills adapters。
 * 页面/布局继续通过 useChatContext 消费共享会话状态，props 保持不变。
 */
export function ChatProvider({
  children,
  initialEvents,
  initialSession,
  standalone = false,
}: Pick<EveChatProviderProps, "children" | "initialEvents" | "initialSession" | "standalone">) {
  return (
    <EveChatProvider
      adapters={{ history: webHistoryAdapter, skills: webSkills }}
      initialEvents={initialEvents}
      initialSession={initialSession}
      standalone={standalone}
    >
      {children}
    </EveChatProvider>
  );
}
