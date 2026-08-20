import type { ReactNode } from "react";
import type { EveDynamicToolPart, EveMessage } from "eve/react";

/** HITL 输入响应（与 agent.respond 的参数形状一致）。 */
export type AgentInputResponse = {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

/**
 * 动态工具 part 的扩展渲染上下文。包内负责 Tool 外壳（header/input/审批
 * 操作区），消费方通过 renderPartExtra 注入工具产物可视化：
 * - web：render_ui → ChatJsonRender + 「应用到看板」；qc_* → QcResultTable；
 *   run_skill_evals → EvalInlineReview；
 * - standalone：不注入（返回 null），回退到默认 JSON 展示。
 */
export type RenderPartExtraContext = {
  readonly part: EveDynamicToolPart;
  readonly message: EveMessage;
  readonly canRespond: boolean;
  readonly onInputResponses: (
    responses: readonly AgentInputResponse[],
  ) => void | Promise<void>;
};

/**
 * 工具产物扩展渲染器。返回 null 表示未命中，由包内回退到默认 ToolOutput。
 */
export type RenderPartExtra = (
  ctx: RenderPartExtraContext,
) => ReactNode | null;

export type ChatRenderers = {
  /** 为 dynamic-tool part 渲染额外可视化（render_ui、qc 查询、评估报告等）。 */
  readonly renderPartExtra?: RenderPartExtra;
};
