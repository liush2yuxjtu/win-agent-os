import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";

/**
 * 业务语言输出观察：面向业务专家的回复不应泄漏内部实现词。
 *
 * 用户是「会 Excel、不懂技术」的业务专家 —— 工具运行时名、queryId、
 * SQL、看板/报表内部标识都不该出现在回复里。
 *
 * 注意：这是观察性 gate（业务词为正断言；内部词为负断言）。
 * 若模型在回复里解释「沙盒/脚本」等过程，此 eval 会失败 —— 说明需要
 * 输出语言约束（当前全局约束已撤销，此 eval 充当回归哨兵）。
 */
export default defineEval({
  description: "业务语言输出：回复含业务结论词、不含内部实现词",
  tags: ["language", "business"],
  async test(t) {
    const turn = await t.send("这个月投产比咋比上个月低了，你觉得是啥原因");
    // agent 可能用 ask_question 确认口径（HITL）：无人值守 eval 需自动应答
    if (turn.inputRequests.length > 0) {
      for (const req of turn.inputRequests) {
        await t.respond([{ text: "继续", requestId: req.requestId }]);
      }
    }
    t.succeeded();
    t.noFailedActions();

    // 正断言：有业务结论
    t.check(t.reply, includes(/投产比|ROI|消耗|成交/));

    // 负断言：内部词不泄漏给业务用户
    t.check(
      t.reply,
      satisfies(
        (text: string) => !/(agentbay_bridge_qc|render_ui|dashboard_|queryId|SQL|qc__|\.eval\.ts)/i.test(text),
        "回复不含内部工具/标识词",
      ),
    );
  },
});
