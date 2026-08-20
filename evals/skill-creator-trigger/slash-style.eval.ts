import { defineEval } from "eve/evals";

/**
 * 触发测试 1：斜杠风格 "/skill-creator「prompt」" 是否触发 skill-creator 加载。
 */
export default defineEval({
  async test(t) {
    await t.send(
      "/skill-creator 本轮只验证触发。加载 skill-creator 后直接回复已加载，不要读取或修改 ai-control，不要派子代理，不要提问。",
    );
    t.succeeded();
    t.calledTool("load_skill", { input: { skill: "skill-creator" } });
    t.noFailedActions();
  },
});
