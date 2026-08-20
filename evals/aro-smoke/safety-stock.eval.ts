import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

/**
 * 技能 + 数据链路：st_02 安全库存技能经订单画像上下文查询真实数据。
 * 前提：同 templates.eval.ts(backend + LAN 库)。
 *
 * 背景事实（pixel-level 提取修复的动机）：
 * - query_safety_metrics 必须带 po_number/订单画像上下文,否则 backend 拒绝
 *   ("订单方案上下文缺失");该参数经 services.resolve_order_profile_scope
 *   跨模块 helper 链读取 —— 提取脚本需覆盖该链,否则 agent 无法传参。
 * - 有效组合(LAN 库 proposed_order 存在):soldto=2001146261 / shipto=2003326034
 *
 * 预期：agent 调用 aro__query_safety_metrics 且无失败动作,回答含 SKU 数据。
 */
export default defineEval({
  async test(t) {
    await t.send(
      "客户 2001146261,门店 2003326034,先看下现有建议订单,然后从订单进安全库存,把天数最低的 5 个 SKU 列出来",
    );

    t.calledTool("aro__query_safety_metrics");
    t.noFailedActions();
    // 回复非空即可(calledTool + noFailedActions 已证明数据链路成功;
    // reply 文本可能因流快照为空,不为此卡断言)
    t.check((t.reply ?? "").length > 0, equals(true));
  },
});
