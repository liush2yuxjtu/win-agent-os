import type { ChatHistoryAdapter, NavigationAdapter, SkillDescriptor } from "@chat-surface-ui/core";
import {
  fetchSessionSnapshot,
  listChatHistory,
  recordChatSession,
  removeChatSession,
  syncChatMessages,
  clearChatHistory,
} from "@/lib/chat-history";
import registryData from "../../../../lib/skills/registry.json";

/**
 * web surface 的 adapters 装配：
 * - history：复用现有 lib/chat-history.ts（服务端 SQLite + 本地缓存双写）；
 * - navigation：基于 next/navigation 的 router，保持原有 pushState/soft nav 行为；
 * - skills：来自 lib/skills/registry.json（只读）。
 */

export const webHistoryAdapter: ChatHistoryAdapter = {
  list: listChatHistory,
  record: recordChatSession,
  syncMessages: syncChatMessages,
  remove: removeChatSession,
  clear: clearChatHistory,
  fetchSnapshot: fetchSessionSnapshot,
};

export function createWebNavigationAdapter(router: {
  replace(url: string): void;
  push(url: string): void;
}): NavigationAdapter {
  return {
    push(url: string) {
      // 会话深链同步保持 pushState 语义：不触发 Next 路由渲染。
      if (typeof window !== "undefined") {
        window.history.pushState(null, "", url);
      }
    },
    replace(url: string) {
      router.replace(url);
    },
    openChat(sessionId?: string) {
      router.push(sessionId ? `/chat/${encodeURIComponent(sessionId)}` : "/chat/new");
    },
  };
}

export const webSkills: SkillDescriptor[] = registryData.skills.map((skill) => ({
  name: skill.name,
  description: skill.description,
  enabled: skill.enabled,
  metadata: skill.metadata
    ? {
        internal:
          typeof skill.metadata.internal === "string" ||
          typeof skill.metadata.internal === "boolean"
            ? skill.metadata.internal
            : undefined,
      }
    : null,
}));
