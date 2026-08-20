"use client";

import type { ReactNode } from "react";
import { AgentChat } from "./agent-chat";
import { ChatRoot } from "./chat-root";
import { useChatContext } from "./chat-context";

/**
 * 双模式布局壳：dashboard（导航 + 看板 + 侧栏聊天）或全屏 AI 聊天。
 *
 * `navigation` 与 `dashboard` 是服务端渲染的 children；聊天会话状态由
 * ChatProvider 统一持有，切换模式只交换布局呈现 —— 消息历史、会话 ID、
 * stream 与工具结果均不重置。
 */
export function DualModeShell({
  navigation,
  dashboard,
  suggestions,
}: {
  readonly navigation: ReactNode;
  readonly dashboard: ReactNode;
  readonly suggestions?: string[];
}) {
  return (
    <ChatRoot>
      <DualModeLayout navigation={navigation} dashboard={dashboard} suggestions={suggestions} />
    </ChatRoot>
  );
}

function DualModeLayout({
  navigation,
  dashboard,
  suggestions,
}: {
  readonly navigation: ReactNode;
  readonly dashboard: ReactNode;
  readonly suggestions?: string[];
}) {
  const { mode } = useChatContext();

  if (mode === "fullscreen") {
    return <AgentChat suggestions={suggestions} variant="fullscreen" />;
  }

  return (
    <div className="dashboard-shell min-h-dvh bg-[#f4f1ea] text-[#1e211d] lg:grid lg:h-dvh lg:grid-cols-[224px_minmax(680px,1fr)_390px] lg:overflow-hidden">
      {navigation}
      {dashboard}
      <aside className="min-h-[680px] border-l border-black/7 bg-[#fbfaf6] lg:min-h-0 lg:overflow-hidden">
        <AgentChat suggestions={suggestions} variant="sidebar" />
      </aside>
    </div>
  );
}
