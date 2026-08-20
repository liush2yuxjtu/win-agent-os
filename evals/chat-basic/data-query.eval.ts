import { defineEval } from "eve/evals";
import { sendAndAnswer } from "./shared";

/**
 * 指标问答：固定查询链路（qc-extension 的 fixed_query）。
 * 覆盖回归：QC MCP bridge 可达时 agent 必须走固定查询工具拿数（不允许编数）；
 * bridge 不可达时允许诚实说明「暂不可用」——此时 fixed_query 可能未被调用，
 * 因此工具断言仅要求「未编造数字」由 noFailedActions 兜底，调用断言标注为软目标。
 */
export default defineEval({
	async test(t) {
		await sendAndAnswer(t, "昨天成交金额多少？广告消耗呢");

		t.succeeded();
		// 数据链路主断言：extension 挂载后的运行时名是 qc__fixed_query。
		t.calledTool("qc__fixed_query").soft();
		t.noFailedActions();
		// 回复必须带业务口径词（不裸编数字）
		t.messageIncludes(/成交|消耗|素材|暂不可用|查不到|没有数据/i);
	},
});
