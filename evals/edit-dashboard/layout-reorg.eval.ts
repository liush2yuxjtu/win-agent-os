import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * 应触发：用户要求重排看板布局（3+2 两行 + 标题）。
 * 断言：调用了 render_ui；spec 为看板类（含 /kpis/ 模板引用、无写死数值、Grid 3/2 列）。
 */
export default defineEval({
  async test(t) {
    const turn = await t.send("帮我把看板改成第一行三张卡第二行两张卡，加个标题");
    t.succeeded();

    t.calledTool("render_ui", { count: 1 });
    t.calledTool("render_ui", {
      input: {
        spec: (value) => {
          const spec = String(value);
          // 看板类：5 个指标的模板引用
          const hasTemplates = /\/kpis\/[0-4]\/(label|value|change)/.test(spec);
          // 布局：Grid 容器 + 3 列 + 2 列
          const hasGrid = /"type"\s*:\s*"Grid"/.test(spec) && /"columns"\s*:\s*3/.test(spec) && /"columns"\s*:\s*2/.test(spec);
          // 无写死数值（看板数据来自模板，不固化具体数字）
          const noHardcoded = !/¥|956万|335万|2\.86|85,478|7,247/.test(spec);
          return hasTemplates && hasGrid && noHardcoded;
        },
      },
    });
    t.check(t.reply, includes("看板"));
    t.noFailedActions();
  },
});
