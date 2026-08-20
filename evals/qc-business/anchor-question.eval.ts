import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * 指标问答冒烟：业务专家问昨日成交/消耗 → agent 应查 QC 数据并回答。
 *
 * 覆盖：固定查询/QC 连接取数链路 + 看板口径一致性。
 * 断言宽松（工具名可能是 qc__* 或走固定脚本）：核心是成功回答且含业务数字。
 */
export default defineEval({
  description: "指标问答：昨日成交/消耗（QC 取数链路冒烟）",
  tags: ["qc", "smoke"],
  async test(t) {
    await t.send("昨天成交金额多少？广告消耗呢");
    t.succeeded();
    t.noFailedActions();
    t.check(t.reply, includes(/成交|消耗|元|万/));
  },
});
