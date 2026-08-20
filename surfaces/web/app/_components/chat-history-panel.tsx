"use client";

import { ChatHistoryPanel as PackageChatHistoryPanel } from "@chat-surface-ui/core";

/**
 * 旧 ChatHistoryPanel 组件名的薄 wrapper：包内组件从 EveChatAdaptersContext
 * 读取 web 装配的 history/navigation adapters，无需在此重复传入。
 */
export function ChatHistoryPanel({ compact = false }: { readonly compact?: boolean }) {
  return <PackageChatHistoryPanel compact={compact} />;
}
