import { defineEval } from "eve/evals";

/**
 * 启动冒烟：agent 必须能完成一轮真实对话。
 *
 * 回归：微信 iLink 会话失效（errcode -14 "session timeout"）曾导致
 * agent 启动即失败（ilink/bot/getupdates failed, NETWORK_ERROR），
 * 阻塞 eve invoke 与 dev server。当时绕过方式为把 bot-bindings 表
 * 的微信绑定置为 disabled；若绑定恢复为 active 且凭据仍失效，
 * 本 eval 会最先暴露启动崩溃（拿不到任何回复）。
 *
 * 覆盖：启动链路（channels/wechat.ts 绑定表读取 + adapter 构造）+
 * 一轮完整对话往返。
 */
export default defineEval({
  async test(t) {
    await t.send("请只回复四个字：收到，好的");

    // 回复必须送达（启动崩溃时此处拿不到回复，直接 fail）
    t.messageIncludes(/收到|好的/);
    t.noFailedActions();

    // 消息流中不得出现微信 iLink 连接错误文本（回归保护）
    t.eventsSatisfy("消息流无 iLink 错误", (events) => {
      const texts: string[] = [];
      for (const ev of events as unknown[]) {
        const e = ev as {
          type?: string;
          data?: {
            part?: { type?: string; text?: string };
            parts?: Array<{ type?: string; text?: string }>;
          };
        };
        if (e.type === "message.part.updated" && e.data?.part?.type === "text" && typeof e.data.part.text === "string") {
          texts.push(e.data.part.text);
        }
        if (e.type === "message.received" && Array.isArray(e.data?.parts)) {
          for (const p of e.data.parts) {
            if (p.type === "text" && typeof p.text === "string") texts.push(p.text);
          }
        }
      }
      const joined = texts.join("\n").toLowerCase();
      return !joined.includes("ilink") && !joined.includes("getupdates failed");
    });
  },
});
