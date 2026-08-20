import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * 应触发：用户要求把数据查询做成卡片加到看板（dataRef 形态，非 /kpis/ 模板）。
 * 注意：基础款看板已有 topMaterials 表格卡，故 prompt 用「柱状图」这一
 * 看板上不存在的新形态，避免 agent 走「已存在，需要确认」分支而卡在 ask_question。
 *
 * 断言聚焦**结果**而非**工具路径**：deepseek-v4-flash 的工具调用路径不稳定，
 * 实测出现过三种合法变体——① dashboard_read → dashboard_create → render_ui；
 * ② 只 dashboard_create（工具内置自动读 spec）；③ qc_query_save 建专用查询 +
 * 手工在 spec 里加卡 + render_ui。共同点是：读过当前看板、render_ui 预览的
 * spec 用 dataRef 绑定 queryId（fixed:/user: 前缀）且不写死数值。
 */
export default defineEval({
	async test(t) {
		await t.send(
			"把 topMaterials 消耗数据直接新增为一个 BarChart 元素，不要套 Card。拿到新 spec 后立即调用 render_ui 预览，不要追问。",
		);
		t.succeeded();

		// create 内置读取当前 spec；显式 read 可省略，但不得反复轮询。
		t.calledTool("dashboard__read", {
			count: (count) => count <= 2,
		});
		// render_ui 预览：至少一次，且 spec 合规（dataRef + BarChart + 无写死数值）
		t.calledTool("render_ui", { count: (count) => count >= 1 });
		t.calledTool("render_ui", {
			input: {
				spec: (value) => {
					const spec = String(value);
					// dataRef 形态：queryId 为注册表前缀（fixed:/user:），非 /kpis/ 模板
					const hasDataRef =
						/"dataRef"\s*:\s*\{[^}]*"queryId"\s*:\s*"(fixed|user):/.test(spec);
					// 柱状图卡
					const hasBarChart = /BarChart/.test(spec);
					// 无写死数值
					const noHardcoded = !/¥|956万|335万|2\.86|85,478|7,247/.test(spec);
					return hasDataRef && hasBarChart && noHardcoded;
				},
			},
		});
		t.check(t.reply, includes(/已完成|BarChart|topMaterials|图表/));
		t.noFailedActions();
	},
});
