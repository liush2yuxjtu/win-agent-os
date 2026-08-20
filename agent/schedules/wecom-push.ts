/**
 * 企微定时主动推送（每 10 分钟）。
 *
 * 向绑定表里所有「企业微信 bot 且有过会话」的最近线程推送一条时间消息
 * （定时任务测试）。后续可替换为经营日报/追投提醒等业务内容。
 *
 * 注意：eve dev 不按 cron 自动触发——用 dispatch 路由手动触发：
 *   curl -X POST http://localhost:3000/eve/v1/dev/schedules/wecom-push
 */
import { defineSchedule } from "eve/schedules";
import { listBindings } from "../lib/platform/web/bot-bindings/db";
import type { BotBinding } from "../lib/platform/web/bot-bindings/types";
import wecom from "../channels/wecom";

// 注：worktree 分支的 BotBinding 尚无 lastThreadId 字段（主分支已加），
// 此处用交叉类型断言保持编译通过；字段缺失时运行值为 undefined → 过滤掉。
const withThreadId = (b: BotBinding): BotBinding & { lastThreadId?: string } =>
  b as BotBinding & { lastThreadId?: string };

export default defineSchedule({
  cron: "*/10 * * * *",
  async run({ to, waitUntil, appAuth }) {
    const now = new Date();
    const timeLabel = now.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
    const message = `【定时任务测试】现在是 ${timeLabel}，服务运行正常 ✅`;

    const bindings = listBindings("wecom").filter(
      (b) => b.status === "active" && Boolean(withThreadId(b).lastThreadId),
    );
    if (bindings.length === 0) {
      console.log("[wecom-push] 无可用会话（企微 bot 尚无对话），跳过本次推送");
      return;
    }

    for (const binding of bindings) {
      const threadId = withThreadId(binding).lastThreadId;
      if (!threadId) continue;
      const adapterName = `wecom:bot_${binding.id}`;
      waitUntil(
        to(wecom, { threadId, adapterName })
          .send(message, { auth: appAuth })
          .catch((error: unknown) => {
            console.error(`[wecom-push] 推送失败（${binding.name}）:`, error instanceof Error ? error.message : String(error));
          }),
      );
      console.log(`[wecom-push] 已推送 → ${binding.name}`);
    }
  },
});
