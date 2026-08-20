"use client";

import { EveChatPlugin } from "@chat-surface-ui/core";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { createWebNavigationAdapter, webHistoryAdapter, webSkills } from "./chat-web-adapters";
import { webChatRenderers } from "./chat-web-renderers";

/**
 * 旧 AgentChat 组件名的薄 wrapper：装配 web adapters（history/navigation/skills）
 * 与 web 工具产物渲染器，聊天逻辑与 UI 已迁入 @chat-surface-ui/core。
 */
export function AgentChat({
  variant = "sidebar",
  suggestions,
  standalone = false,
}: {
  readonly variant?: "sidebar" | "fullscreen";
  readonly suggestions?: string[];
  readonly standalone?: boolean;
}) {
  const router = useRouter();
  const navigation = useMemo(() => createWebNavigationAdapter(router), [router]);

  return (
    <EveChatPlugin
      adapters={{
        history: webHistoryAdapter,
        navigation,
        skills: webSkills,
      }}
      renderers={webChatRenderers}
      standalone={standalone}
      suggestions={suggestions}
      variant={variant}
    />
  );
}
