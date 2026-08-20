import { defineEval } from "eve/evals";
import { sendAndAnswer } from "./shared";

/**
 * L1 基础冒烟：打招呼不应触发任何业务工具。
 * 覆盖回归：agent 启动/平台路径/通道挂载后最小可对话性（重构后每轮 turn 必须正常完成，
 * 不因沙盒、扩展或 store 初始化崩溃）。问候场景不允许调用查询/报表等重型工具。
 */
export default defineEval({
  async test(t) {
    await sendAndAnswer(t, "早，在吗？大概介绍一下你能帮我做什么");

    t.succeeded();
    t.messageIncludes(/素材|消耗|投放|看板|报告/i);
    t.notCalledTool("fixed_query");
    t.notCalledTool("save_report");
    t.usedNoTools();
    t.noFailedActions();
  },
});
