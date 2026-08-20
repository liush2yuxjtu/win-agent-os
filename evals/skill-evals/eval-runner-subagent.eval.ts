import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * eval-runner 子代理真实执行(CC 风格核心):Functional 用例必须由
 * 声明式 eval-runner 子代理(agent/subagents/eval-runner/)真实执行,
 * 而非仅模型模拟 —— 回归 551876e 的升级(子代理加载 SKILL.md 作指令,
 * 真实产出后以 EvalExecutionResult 结构化返回 verdict/evidence/output)。
 */
export default defineEval({
  description: "技能功能评估:用例由 eval-runner 子代理真实执行并返回结构化判定",
  tags: ["skill-evals", "subagent", "injection"],
  async test(t) {
    await t.send(
      "【验收测试·必须调用工具】用 eval-runner 子代理工具执行 ai-control 技能的一个功能评估用例" +
        "(用例 prompt:请列出当前可用的技能清单并简要说明各自用途)," +
        "然后把子代理返回的判定结果(verdict/evidence)汇报给我。\n" +
        "硬性要求:" +
        "这是自动化验收测试,你的工具调用序列会被程序化检查,序列必须是:load_skill → eval-runner → (汇报)。" +
        "① 第一步:调用 load_skill 工具加载 ai-control 技能(沙盒 read_file 看不到宿主技能包,load_skill 是宿主技能唯一入口)," +
        "把返回的完整技能指令全文作为『技能指令:』段落放进 eval-runner 的派发消息(子代理是隔离上下文,只能靠消息内容,禁止只传技能名)。" +
        "② 第二步:必须真实调用 eval-runner 工具派发子代理执行用例,拿到 verdict/evidence 后汇报。" +
        "禁止用 load_skill 的结果代替子代理执行(load_skill 只是拿指令全文的手段);" +
        "禁止直接凭自己的知识作答,禁止用 bash/read_file/run_skill_evals 替代子代理执行。" +
        "只要没调用 eval-runner,无论回答内容如何都判失败。",
    );

    // 必须派发声明式 eval-runner 子代理(工具名 = 子代理 id)
    t.calledSubagent("eval-runner");
    t.noFailedActions();
    // 汇报里应出现结构化判定字段
    t.check(t.reply, includes(/pass|partial|fail/));
  },
});
