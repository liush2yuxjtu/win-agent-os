import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * 不应触发：纯数据问答（无改看板意图）。
 * 断言：允许渲染分析摘要卡片（写死数值快照可接受），但 render_ui 的 spec
 * 绝不含 /kpis/ 模板或 dataRef 绑定 —— 即不生成看板类 spec。
 */
export default defineEval({
  async test(t) {
    const turn = await t.send("近7日成交956万，广告消耗335万，帮我分析一下ROI表现怎么样，要不要加预算");
    t.succeeded();

    t.calledTool("render_ui", {
      input: {
        spec: (value) => /\/kpis\/|dataRef/.test(String(value)),
      },
      // 匹配（生成看板 spec）的调用数必须为 0；分析摘要卡不匹配此约束
      count: 0,
    });
    t.check(t.reply, includes("ROI"));
  },
});
