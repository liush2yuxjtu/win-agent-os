import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * dashboard extension 冒烟：看板读取必须走 dashboard__read。
 *
 * 覆盖：dashboard extension 挂载后工具注册正确(命名空间 dashboard__)、
 * 平台指令中立化后看板流程仍能正确引导(业务说明已下沉到 extension instructions)。
 */
export default defineEval({
  description: "dashboard extension: 看板读取走 dashboard__read",
  async test(t) {
    const turn = await t.send("当前看板上都有哪些卡片？");

    t.succeeded();
    t.calledTool("dashboard__read");
    t.check(t.reply, includes("看板"));
    t.noFailedActions();
  },
});
