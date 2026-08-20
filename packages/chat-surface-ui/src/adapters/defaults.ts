import type { ChatHistoryAdapter } from "./history";
import type { NavigationAdapter } from "./navigation";

/** 不接历史存储时的默认 adapter：空清单、不落盘、不恢复。 */
export const noopHistoryAdapter: ChatHistoryAdapter = {
  list: async () => [],
  record: () => {},
  syncMessages: () => {},
  remove: async () => {},
  clear: () => {},
  fetchSnapshot: async () => null,
};

/** 不接路由框架时的默认导航：直接操作浏览器 history。 */
export const defaultNavigationAdapter: NavigationAdapter = {
  push(url: string) {
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", url);
    }
  },
  replace(url: string) {
    if (typeof window !== "undefined") {
      window.location.replace(url);
    }
  },
  openChat(sessionId?: string) {
    if (typeof window !== "undefined") {
      window.location.assign(
        sessionId ? `/chat/${encodeURIComponent(sessionId)}` : "/chat/new",
      );
    }
  },
};
