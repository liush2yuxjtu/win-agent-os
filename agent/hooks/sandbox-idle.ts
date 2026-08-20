import { defineHook } from "eve/hooks";

/**
 * 沙箱活动续命钩子：agent 或用户任何活动都重置该会话的 10 分钟
 * idle 计时器（「最近一次活动后 10 分钟无活动」才回收，而非对话开始
 * 后 10 分钟）。
 *
 * 活动事件集（有意排除 message.appended 等逐块流式事件，避免高频重置）：
 *  - turn.started：用户/系统发消息
 *  - step.started / step.completed：agent 执行步骤
 *  - actions.requested / action.result：工具调用
 *  - message.completed：模型输出完成
 *  - subagent.called / subagent.completed：子代理派发/返回
 *
 * 计时器本体与按用户配额回收在 agent/sandbox.ts 的 onSession 中维护
 * （globalThis.__sandboxIdle.entries / refreshes）。
 */
export default defineHook({
  events: {
    "turn.started": refresh,
    "step.started": refresh,
    "step.completed": refresh,
    "actions.requested": refresh,
    "action.result": refresh,
    "message.completed": refresh,
    "subagent.called": refresh,
    "subagent.completed": refresh,
  },
});

/** 重置该会话的闲置计时器（registry 里注册的 refresh 闭包）。 */
function refresh(_event: unknown, ctx: { session: { id: string } }) {
  const g = globalThis as unknown as {
    __sandboxIdle?: { refreshes?: Map<string, () => void> };
  };
  g.__sandboxIdle?.refreshes?.get(ctx.session.id)?.();
}
