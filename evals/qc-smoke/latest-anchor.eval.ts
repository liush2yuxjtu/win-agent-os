import { defineEval } from "eve/evals";

/**
 * QC 数据链路冒烟：agent 必须能从 QC 数据源拿到真实数据日期。
 *
 * 回归：QC MCP bridge（默认 http://127.0.0.1:7331/mcp）未启动时，
 * dashboard 与 qc 工具全部拿不到数据（页面显示「QC 暂不可用」）。
 * bridge 是手动启动的外部进程（bridge/qc-mcp），重启机器/开发机后
 * 容易漏起 —— 本 eval 用真实查询兜底验证。
 *
 * 覆盖：qc-extension 挂载 → qc__fixed_query 工具 → QC bridge →
 * MCP_source stdio server → SQL Server 全链路。
 */
export default defineEval({
	async test(t) {
		await t.send(
			"用 qc 工具查询 QC 数据源的最新可用数据日期（不要猜，查出来告诉我日期），" +
				"然后把日期念一遍",
		);

		// 必须真实调用 qc 固定查询工具（MCP 工具运行时名 = <connection>__<tool>）
		t.calledTool("qc__fixed_query");
		t.noFailedActions();
		// 以工具结果锁定真实日期；模型是否在同一步复述只记软指标。
		t.eventsSatisfy("QC 工具返回 YYYY-MM-DD", (events) =>
			events.some((event) => {
				if (event.type !== "action.result") return false;
				const result = event.data.result;
				if (
					result.kind !== "tool-result" ||
					result.toolName !== "qc__fixed_query"
				)
					return false;
				return /\d{4}-\d{2}-\d{2}/.test(JSON.stringify(result.output));
			}),
		);
		t.messageIncludes(/\d{4}-\d{2}-\d{2}/).soft();
	},
});
