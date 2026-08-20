import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * 方案 A 数据桥接端到端（AgentBay 沙盒分析）。
 *
 * 业务专家提问（无技术词）→ agent 应路由到 agentbay_bridge_qc：
 * QC 数据（内网 MCP bridge）→ 写入 AgentBay 沙盒 → 脚本算投产比 → 读回。
 *
 * 前置条件：QC bridge 在跑（:7331）+ AGENTBAY_API_KEY 可用。
 * 失败时 t.noFailedActions() 会暴露桥接/沙盒哪一环出错。
 */
export default defineEval({
  description: "AgentBay 沙盒 ROI 分析（方案 A 数据桥接）端到端：业务提问 → 沙盒分析 → 业务回复",
  tags: ["agentbay", "sandbox", "qc"],
  async test(t) {
    const turn = await t.send(
      "帮我分析最近 7 天高消耗素材的投产比并排出前 5 名。请实际运行计算脚本，不要只查表或做看板，最后给一句投放建议。",
    );
    t.succeeded();
    t.noFailedActions();

    // 必须走方案 A 桥接工具（数据经沙盒分析，而非仅查表返回）
    t.calledTool("agentbay_bridge_qc");

    // 回复应含业务结论词汇
    t.check(t.reply, includes(/投产比|ROI|回报/));
  },
});
