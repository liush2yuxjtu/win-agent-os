// @chat-surface-ui/core 公开 API。
// 组件源码直接经 Bundler resolution 由消费方编译（Next transpilePackages /
// Vite 等），本文件只做类型与实现的统一出口。

// 聊天核心
export {
  EveChatProvider,
  ChatProvider,
  type EveChatProviderProps,
} from "./core/EveChatProvider";
export {
  EveChatRoot,
  ChatRoot,
  type EveChatRootProps,
} from "./core/EveChatRoot";
export { useChatContext, type ChatContextValue, type WorkspaceMode } from "./core/chat-context";
export { useChatRoot, type ChatRootValue } from "./core/chat-root-context";
export { useEveChatAdapters, useEveChatRenderers, type EveChatAdapters } from "./core/contexts";

// 聊天 surface 插件
export {
  EveChatPlugin,
  type EveChatPluginProps,
} from "./plugin/EveChatPlugin";
export {
  normalChatPlugin,
  resolveSurfacePlugin,
  type SurfacePlugin,
  type SurfacePluginContext,
  type SurfaceProfile,
  type SurfaceView,
} from "./plugin/SurfacePlugin";

// 会话事件轻量投影
export {
  projectSessionEvents,
  type SessionProjection,
  type PendingInput,
} from "./projection/projectSessionEvents";

// adapters 类型
export type {
  ChatHistoryAdapter,
  ChatHistoryEntry,
} from "./adapters/history";
export type { NavigationAdapter } from "./adapters/navigation";
export type { SkillDescriptor } from "./adapters/skills";
export type {
  AgentInputResponse,
  ChatRenderers,
  RenderPartExtra,
  RenderPartExtraContext,
} from "./adapters/renderers";
export {
  defaultNavigationAdapter,
  noopHistoryAdapter,
} from "./adapters/defaults";

// 聊天消息与历史面板（包内实现）
export { EveMessage } from "./chat/EveMessage";
export { ChatHistoryPanel } from "./chat/ChatHistoryPanel";

// ai-elements 组件（原 components/ai-elements/*）
export * from "./ai-elements";
// UI 原语（包内复制版，css 类保持 Tailwind class）
export * from "./ui";

// 工具函数
export { cn } from "./lib/cn";
export { normalizeMessageParts } from "./lib/normalize-message-parts";
