import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createWeChatAcpAdapter } from "chat-adapter-wechat";
const dataDir = "/Users/liushiyuwin/MCP_connect_skill/lib/bot-bindings/.wechat-bot-123";
const adapter = createWeChatAcpAdapter({ botId: "bot-123", dataDir });
const chat = new Chat({
  userName: "test",
  adapters: { "wechat:bot_7": adapter },
  state: createMemoryState(),
});
try {
  console.log("[test] 初始化...");
  await chat.initialize();
  console.log("[test] initialize OK — 轮询运行中");
  await new Promise((r) => setTimeout(r, 10000));
  console.log("[test] 10 秒轮询无异常 ✅");
  process.exit(0);
} catch (e) {
  console.error("[test] 失败:", e instanceof Error ? e.message : String(e));
  process.exit(1);
}
