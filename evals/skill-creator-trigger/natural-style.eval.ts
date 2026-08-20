import { defineEval } from "eve/evals";

/**
 * 触发测试 2：自然语言 "帮我进化 ai-control 技能" 是否触发 skill-creator 加载。
 *
 * 本 eval 只测触发，不执行完整技能改进闭环。
 */
export default defineEval({
	async test(t) {
		await t.send(
			"帮我进化 ai-control 技能。本轮只验证触发。加载 skill-creator 后直接回复已加载，不要读取或修改 ai-control，不要派子代理，不要提问。",
		);
		t.succeeded();
		t.calledTool("load_skill", { input: { skill: "skill-creator" } });
		t.noFailedActions();
	},
});
