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
      "① 第一步:调用 load_skill 工具加载 ai-control 技能(沙盒 read_file 看不到宿主技能包,load_skill 是宿主技能唯一入口)," +
      "把返回的完整技能指令全文作为『技能指令:』段落放进 eval-runner 派发消息(子代理是隔离上下文,只能靠消息内容,禁止只传技能名)。" +
      "② 第二步:调用 eval-runner 子代理工具真实执行功能用例(用例 prompt:请列出当前可用的技能清单并简要说明各自用途)。" +
      "③ 第三步:把 eval-runner 返回的判定结果作为 executionResults 调用 run_skill_evals 工具注入汇总。" +
      "④ 最后告诉我触发率和功能通过率。\n" +
      "禁止用 load_skill 的结果代替子代理执行;禁止用 bash/read_file 读取技能文件后走内部模拟路径;" +
      "禁止调用 ask_question 或任何暂停等输入的机制——本场景是自动化验收,汇总后直接汇报结果即可。" +
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
