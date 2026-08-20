import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * 评估结果持久化:run_skill_evals 完成后,逐例判定/真实输出/基线必须落
 * iteration 工作区 + sqlite(skill_eval_runs 表) —— 回归 551876e 的
 * db.ts 与迭代工作区约定;跨会话可查、可续跑。
 */
export default defineEval({
  description: "评估结果持久化:iteration 工作区 + sqlite 落库",
  tags: ["skill-evals", "persistence", "sqlite"],
  async test(t) {
    await t.send(
      "【验收测试·必须转述工具返回】对 ai-control 技能跑一次快速功能评估(调用 run_skill_evals 工具)," +
        "完成后汇报必须包含以下三项,缺一不可:" +
        "① 本次评估的 iteration 编号;② 评估产物落盘的 workspaceDir 工作区路径;" +
        "③ sqlite 落库确认(skill_eval_runs 表)。\n" +
        "硬性要求:必须真实调用 run_skill_evals 工具;汇报时把工具返回中的 iteration/workspaceDir 字段原样转述,不得省略;" +
        "禁止调用 ask_question 或任何暂停等输入的机制——本场景是自动化验收,汇总后直接汇报结果即可。",
    );

    t.calledTool("run_skill_evals");
    t.noFailedActions();
    // 回复应提及迭代工作区与 sqlite 持久化
    t.check(t.reply, includes(/iteration/));
    t.check(t.reply, includes(/sqlite|skill-evals\.db|落库/));
  },
});
