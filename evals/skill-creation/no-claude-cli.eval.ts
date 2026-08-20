import { defineEval } from "eve/evals";
import { sendAndAnswer } from "./shared";

/**
 * 评估请求带"不要用 python 脚本"约束时，agent 应调用 eve 原生工具
 * （run_skill_evals），不得尝试 claude CLI / run_loop 脚本。
 */
export default defineEval({
  async test(t) {
    await sendAndAnswer(t, "评估 ai-control 技能的触发准确性（不要用 python 脚本）");

    // 不得执行 claude CLI / run_loop / python 脚本
    t.calledTool("bash", {
      input: { command: /run_loop|claude|python -m scripts/ },
      count: 0,
    });

    // 应调用 eve 原生评估工具
    t.calledTool("run_skill_evals");
    t.noFailedActions();
  },
});
