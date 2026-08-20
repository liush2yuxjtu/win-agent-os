import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * qc extension 冒烟：数据问答必须走 qc__fixed_query(固定只读 SQL)。
 *
 * 覆盖：qc extension 挂载后工具注册正确(命名空间 qc__)、
 * 固定脚本优先的取数路由未被平台指令回归破坏。
 * 依赖 QC MCP bridge(7331)可达；不可达时工具返回错误,断言会失败。
 */
export default defineEval({
  description: "qc extension: 数据问答走 qc__fixed_query 固定脚本",
  async test(t) {
    await t.send("最新的可用数据日期是哪天？");

    t.succeeded();
    t.calledTool("qc__fixed_query");
    t.check(t.reply, includes(/20\d{2}(?:-\d{2}-\d{2}|年\d{1,2}月\d{1,2}日)/));
    t.noFailedActions();
  },
});
