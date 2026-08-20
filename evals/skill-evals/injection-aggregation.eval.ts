import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * run_skill_evals 注入聚合链路:model 并行派发 eval-runner 子代理真实执行
 * 用例后,把 executionResults 注入 run_skill_evals 完成聚合(跳过内部模拟
 * 判定),产出逐例证据 + 触发率/通过率摘要 —— 回归 551876e 的完整闭环。
 */
export default defineEval({
  description: "技能评估闭环:子代理真实执行 → executionResults 注入 → run_skill_evals 聚合",
  tags: ["skill-evals", "subagent", "injection"],
  async test(t) {
    await t.send(
      "这是自动化验收测试,你的工具调用序列会被程序化检查,序列必须是:load_skill → eval-runner → run_skill_evals → (汇报)。" +
      "① 调用 load_skill 加载 ai-control(沙盒 read_file 看不到宿主技能包,load_skill 是唯一入口)。" +
      "② 调用 eval-runner 时,消息必须严格包含以下五段:" +
      "『技能名:ai-control』『技能指令:<load_skill 返回的完整全文>』" +
      "『任务输入:我们追投计划健康度怎么样？哪些预算该加哪些该停？给我个健康度评分和可执行的建议。』" +
      "『期望要点:健康度评分,预算加停建议,不编造动态数据』『用例标识:ai-control-health-score』。" +
      "要求子代理不调用工具,只按技能指令生成 output,并严格返回 caseId/input/verdict/evidence/output 五个字段。" +
      "③ 把 eval-runner 返回的对象原样放进 executionResults 数组,调用 run_skill_evals,skillName 传 ai-control。" +
      "④ 最后告诉我触发率和功能通过率。\n" +
      "禁止用 load_skill 的结果代替子代理执行;禁止用 bash/read_file 替代 eval-runner;" +
      "禁止调用 ask_question 或任何暂停输入的机制——本场景是自动化验收,汇总后直接汇报。" +
      "只要没调用 eval-runner,无论回答内容如何都判失败。",
    );

    // 真实执行 + 聚合两个环节都必须走
    t.calledSubagent("eval-runner");
    t.calledTool("run_skill_evals");
    t.noFailedActions();
    // 汇总回复应含量化指标
    t.check(t.reply, includes(/\d+(\.\d+)?%|\d+\/\d+/));
  },
});
