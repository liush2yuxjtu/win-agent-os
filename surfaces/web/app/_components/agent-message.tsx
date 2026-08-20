"use client";

import { EveMessage, type ChatRenderers } from "@chat-surface-ui/core";
import type { ComponentProps } from "react";
import { webChatRenderers } from "./chat-web-renderers";

export type { AgentInputResponse } from "@chat-surface-ui/core";

/**
 * 旧 AgentMessage 组件名的薄 wrapper：注入 web 工具产物渲染器。
 * 消息渲染逻辑已迁入 @chat-surface-ui/core 的 EveMessage。
 */
export function AgentMessage(
  props: Omit<ComponentProps<typeof EveMessage>, "renderers"> & {
    readonly renderers?: ChatRenderers;
  },
) {
  return <EveMessage {...props} renderers={props.renderers ?? webChatRenderers} />;
}
