import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * 冒烟：aro extension 工具链端到端。
 * 前提：aro backend 运行在 8000(LAN 测试库 127.0.0.1:8635),
 * agent 挂载 aro extension(根 package.json 需声明 aro-extension workspace:*,
 * 否则 eve dev-runtime 快照不包含它,38 个 aro__ 工具全部 UNRESOLVED)。
 *
 * 预期：agent 识别"ARO 提示模板"需求 → 调用 aro__get_templates →
 * 返回 LAN 测试库真实模板(≥1 条)并格式化回答。
 */
export default defineEval({
  async test(t) {
    await t.send("ARO 系统里有哪些提示模板?列出来给我看看");

    t.calledTool("aro__get_templates");
    t.noFailedActions();
    t.check(t.reply, includes("CT-"));
  },
});
