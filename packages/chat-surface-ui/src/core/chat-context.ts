import type { EveMessageData, UseEveAgentHelpers } from "eve/react";
import { createContext, useContext } from "react";
import type { PromptInputMessage } from "../ai-elements/prompt-input";
import type { ChatHistoryEntry } from "../adapters/history";

/**
 * 产品模式：dashboard 布局（看板 + 侧栏聊天）或全屏 AI 聊天。
 * 两种模式共享同一个 ChatProvider 实例，切换只改变布局呈现，
 * 不重建会话 —— 消息历史、会话 ID、stream 状态与工具结果全部保留。
 */
export type WorkspaceMode = "dashboard" | "fullscreen";

export type ChatContextValue = {
  readonly agent: UseEveAgentHelpers<EveMessageData>;
  readonly mode: WorkspaceMode;
  readonly setMode: (mode: WorkspaceMode) => void;
  readonly cancellationError?: string;
  readonly localGreeting: boolean;
  readonly isBusy: boolean;
  readonly isEmpty: boolean;
  readonly hasConversation: boolean;
  readonly errorMessage?: string;
  readonly requestCancellation: () => void;
  readonly handleSubmit: (message: PromptInputMessage) => Promise<void>;
  /** 恢复一个历史会话（重放服务端事件后重新挂载）。 */
  readonly restoreSession: (entry: ChatHistoryEntry) => Promise<void>;
  /** 开启全新会话。 */
  readonly startNewSession: () => void;
  /** 历史会话恢复进行中。 */
  readonly restoring: boolean;
  /** 独立页模式（/chat/<id>、/chat/new，无看板布局）。 */
  readonly isStandalone: boolean;
};

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) {
    throw new Error("useChatContext must be used within an EveChatProvider.");
  }
  return value;
}
