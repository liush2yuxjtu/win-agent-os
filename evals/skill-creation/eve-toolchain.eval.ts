import { defineEval } from "eve/evals";
import { sendAndAnswer } from "./shared";

/**
 * 技能改进应走 eve 原生工具链（run_skill_evals），而非 claude CLI 的 Python 脚本。
 * 覆盖 skill-creator 的「eve 环境适配」节。
 */
export default defineEval({
	async test(t) {
		await sendAndAnswer(
			t,
			"请先加载 skill-creator，然后只调用一次 run_skill_evals 评估 ai-control 当前质量。不要调用 optimize_skill_description、generate_negative_cases、eval_trends，不要修改技能，不要追问。",
			"继续执行 run_skill_evals，不要改技能",
		);
		t.succeeded();

		// 必须加载 skill-creator 方法论并调用 eve 原生评估工具
		t.loadedSkill("skill-creator");
		t.calledTool("run_skill_evals");

		// 不得运行依赖 claude CLI 的 Python 脚本（run_loop / run_eval / improve_description）
		t.calledTool("bash", {
			input: {
				command: /run_loop|run_eval|improve_description|python -m scripts/,
			},
			count: 0,
		});

		// 全链路无失败动作
		t.noFailedActions();
	},
});
