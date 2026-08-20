import { createContext, useContext } from "react";
import type { ChatHistoryAdapter } from "../adapters/history";
import type { NavigationAdapter } from "../adapters/navigation";
import type { ChatRenderers } from "../adapters/renderers";
import type { SkillDescriptor } from "../adapters/skills";

/**
 * EveChatPlugin 装配上下文：Provider/Root 或 Plugin 注入 adapters 与
 * renderers，包内组件（ChatHistoryPanel、EveMessage）从这里读取。
 */
export type EveChatAdapters = {
  readonly history?: ChatHistoryAdapter;
  readonly navigation?: NavigationAdapter;
  readonly skills?: readonly SkillDescriptor[];
};

export type EveChatRenderers = ChatRenderers;

export const EveChatAdaptersContext = createContext<EveChatAdapters>({});
export const EveChatRenderersContext = createContext<EveChatRenderers>({});

export function useEveChatAdapters(): EveChatAdapters {
  return useContext(EveChatAdaptersContext);
}

export function useEveChatRenderers(): EveChatRenderers {
  return useContext(EveChatRenderersContext);
}
