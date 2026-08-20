/**
 * 导航 adapter：替代 chat UI 里的 next/navigation 与 window.history 直操作。
 *
 * - `push`：URL 同步（pushState 语义，不触发路由渲染）。用于会话深链
 *   /chat/<sessionId> 与「新建对话」回根路径。
 * - `replace`：真实导航（router.replace 语义）。用于独立页「返回看板」。
 * - `openChat`：真实导航到聊天页（router.push 语义）。
 */
export interface NavigationAdapter {
  /** pushState 风格的 URL 同步（不触发 React 路由渲染）。 */
  push(url: string): void;
  /** 真实导航（替换当前历史记录）。 */
  replace(url: string): void;
  /** 真实导航到聊天深链页。 */
  openChat(sessionId?: string): void;
}
