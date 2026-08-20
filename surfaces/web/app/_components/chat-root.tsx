"use client";

import { EveChatRoot, type EveChatRootProps } from "@chat-surface-ui/core";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { createWebNavigationAdapter, webHistoryAdapter } from "./chat-web-adapters";

export { useChatRoot } from "@chat-surface-ui/core";

/**
 * 旧 ChatRoot 组件名的薄 wrapper：装配 web history/navigation adapters，
 * 会话恢复/切换逻辑已迁入 @chat-surface-ui/core 的 EveChatRoot。
 */
export function ChatRoot({
  children,
  initialEntry,
  standalone = false,
}: Pick<EveChatRootProps, "children" | "initialEntry" | "standalone">) {
  const router = useRouter();
  const navigation = useMemo(() => createWebNavigationAdapter(router), [router]);

  return (
    <EveChatRoot
      adapters={{ history: webHistoryAdapter, navigation }}
      initialEntry={initialEntry}
      standalone={standalone}
    >
      {children}
    </EveChatRoot>
  );
}
