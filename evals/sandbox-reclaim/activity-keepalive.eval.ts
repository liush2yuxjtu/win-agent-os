import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * 沙盒活动续命集成冒烟（回归 98898a5）：
 * 正常对话（含工具调用）在活动续命机制下完整执行、不被闲置回收误伤，
 * 且无失败动作。续命 hook 监听 turn/step/工具/子代理等 8 类活动事件，
 * 任何活动都重置 10 分钟计时器——本用例验证真实会话流程不受影响。
 */
export default defineEval({
  description: "沙盒活动续命冒烟:正常对话(含工具调用)完整完成,无失败动作",
  tags: ["sandbox", "reclaim", "smoke"],
  async test(t) {
    await t.send(
      "【冒烟】请调用 load_skill 工具加载 ai-control 技能,然后一句话说明它的职责,再列出你当前可用的子代理工具名字。",
    );

    t.succeeded();
    t.noFailedActions();
    // 工具调用发生了（load_skill 是宿主技能入口，说明沙盒会话链路健康）
    t.check(t.reply, includes(/ai-control|子代理|eval-runner/));
  },
});
