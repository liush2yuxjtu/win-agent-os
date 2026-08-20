import { defineEval } from "eve/evals";
import { sendAndAnswer } from "./shared";

/**
 * 冒烟测试：exa connection 可用。
 * agent 应调用 exa 搜索工具（extension + connection 双层命名空间），
 * 并基于搜索结果回答、附来源。
 */
export default defineEval({
  async test(t) {
    await sendAndAnswer(t, "用 exa 搜索一下 2026 年 8 月 AI 行业的最新新闻，列出 3 条并附来源链接");

    // exa extension 挂载 exa connection，运行时名 = exa__exa__web_search_exa。
    t.calledTool("exa__exa__web_search_exa");
    t.noFailedActions();
  },
});
