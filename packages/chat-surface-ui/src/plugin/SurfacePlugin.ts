import type { ReactNode } from "react";
import type { ChatHistoryAdapter } from "../adapters/history";
import type { NavigationAdapter } from "../adapters/navigation";
import type { ChatRenderers } from "../adapters/renderers";
import type { SkillDescriptor } from "../adapters/skills";

export type SurfaceProfile = "web" | "standalone" | "headless";
export type SurfaceView = "chat" | "composer" | "message" | "history" | "dashboard";

/**
 * Surface 插件：允许消费方按 view 覆盖/扩展聊天 surface 的局部渲染。
 *
 * - `id`：全局唯一标识；
 * - `match(view)`：是否接管该 view；
 * - `render(ctx)`：接管时返回 ReactNode；返回 null 表示让出给默认实现。
 *
 * 内置 normal-chat 插件匹配 view === "chat" 且 render 返回 null，
 * 表示「聊天视图使用默认 UI」——保留插槽同时不改变默认行为。
 */
export interface SurfacePlugin {
  readonly id: string;
  match(view: SurfaceView): boolean;
  render(ctx: SurfacePluginContext): ReactNode | null;
}

export type SurfacePluginContext = {
  readonly profile: SurfaceProfile;
  readonly view: SurfaceView;
  readonly adapters: {
    readonly history?: ChatHistoryAdapter;
    readonly navigation?: NavigationAdapter;
    readonly skills?: readonly SkillDescriptor[];
  };
  readonly renderers: ChatRenderers;
};

export const normalChatPlugin: SurfacePlugin = {
  id: "normal-chat",
  match: (view) => view === "chat",
  render: () => null,
};

/**
 * 解析 view 对应的第一个非空插件渲染结果。无插件接管时返回 null，
 * 调用方回退到默认 UI。
 */
export function resolveSurfacePlugin(
  plugins: readonly SurfacePlugin[],
  view: SurfaceView,
  ctx: SurfacePluginContext,
): ReactNode | null {
  for (const plugin of plugins) {
    if (!plugin.match(view)) continue;
    const rendered = plugin.render(ctx);
    if (rendered !== null) return rendered;
  }
  return null;
}
