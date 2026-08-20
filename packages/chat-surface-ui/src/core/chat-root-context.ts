import { createContext, useContext } from "react";
import type { ChatHistoryEntry } from "../adapters/history";

export type ChatRootValue = {
  /** 恢复一个历史会话：重放服务端事件 → remount EveChatProvider 绑定该会话。 */
  readonly restoreSession: (entry: ChatHistoryEntry) => Promise<void>;
  /** 开启全新会话（清空恢复目标并 remount）。 */
  readonly startNewSession: () => void;
  /** 恢复进行中（正在重放历史事件）。 */
  readonly restoring: boolean;
};

export const ChatRootContext = createContext<ChatRootValue | null>(null);

export function useChatRoot(): ChatRootValue {
  const value = useContext(ChatRootContext);
  if (!value) {
    throw new Error("useChatRoot must be used within an EveChatRoot.");
  }
  return value;
}
