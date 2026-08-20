import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * 应触发：用户要求恢复基础款看板。
 * 断言：调用了 render_ui；spec 为看板类且覆盖 5 个指标模板（0..4）。
 */
export default defineEval({
	async test(t) {
		await t.send(
			"我把看板改坏了。直接恢复基础款并立即调用 render_ui 预览，不要追问",
		);
		t.succeeded();

		t.calledTool("render_ui", { count: 1 });
		t.calledTool("render_ui", {
			input: {
				spec: (value) => {
					const spec = String(value);
					const hasAllIndexes = [0, 1, 2, 3, 4].every((i) =>
						new RegExp(`/kpis/${i}/label`).test(spec),
					);
					const noHardcoded = !/¥|956万|335万|2\.86|85,478|7,247/.test(spec);
					return hasAllIndexes && noHardcoded;
				},
			},
		});
		t.check(t.reply, includes("看板"));
		t.noFailedActions();
	},
});
