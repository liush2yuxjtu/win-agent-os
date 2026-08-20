import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { sendAndAnswer } from "./shared";

/**
 * 评估请求应返回 Trigger 结果（触发命中），覆盖 run_skill_evals 的
 * 核心输出契约（触发准确性 + 功能正确性都在回复里）。
 */
export default defineEval({
  async test(t) {
    await sendAndAnswer(t, "评估一下 ai-control 技能");
    t.succeeded();

    t.calledTool("run_skill_evals");
    t.check(t.reply, includes("触发"));
    t.noFailedActions();
  },
});
