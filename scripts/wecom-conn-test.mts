import { createWeComBotAdapter } from "@agentor/chat-wecom";

const botId = "aibGZaWjLlmd-xRJA1hrfiNUexwZrmd5vRS";
const secret = "mX2WCMxtBcm1PhLN3fAgYoyn8czOIs8ilvNtNmLnoSN";

console.log("[test] 构造 WeCom Bot adapter (WS)...");
try {
  const adapter = createWeComBotAdapter({ botId, secret });
  console.log("[test] 构造成功:", (adapter as { name?: string }).name ?? "unnamed");
  // 观察 12 秒：构造后 WS 是否建立/报错（adapter 内部日志会输出）
  await new Promise((resolve) => setTimeout(resolve, 12000));
  console.log("[test] 12 秒观察期结束（无抛错 = 连接未立即失败）");
} catch (e) {
  console.log("[test] 构造/连接失败:", e instanceof Error ? e.message : String(e));
  process.exit(1);
}
