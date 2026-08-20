import { defineEval } from "eve/evals";

/**
 * 触发测试 3：趋势查询 —— 是否直接触发 eval_trends 工具（不经 skill-creator）。
 */
export default defineEval({
  async test(t) {
    const turn = await t.send("看看技能评估的趋势");
    t.succeeded();
    t.calledTool("eval_trends");
    t.noFailedActions();
  },
});
