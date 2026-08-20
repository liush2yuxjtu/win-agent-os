import { defineEval } from "eve/evals";

/**
 * 聊天链路在线冒烟(verify-chat-basic 的最小态):dev server + 嵌入式
 * agent 健康时,便宜 prompt 应秒回且无失败动作。回归 c710540 的
 * allowedDevOrigins 修复(127.0.0.1 访问 dev 资源被 403 时聊天交互 JS
 * 不加载,此 eval 会整体失败)。
 */
export default defineEval({
  description: "聊天在线冒烟:便宜 prompt 完成且无失败动作",
  tags: ["smoke", "chat"],
  async test(t) {
    await t.send("早,今天素材消耗咋样,大概说下就行");
    t.succeeded();
    t.noFailedActions();
  },
});
