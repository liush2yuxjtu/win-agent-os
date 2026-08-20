/** 企业微信 bot 连接测试：经代理（读 ALL_PROXY）用给定 Bot ID/Secret 建立 WS 长连接。 */
import WebSocket from "ws";
import { SocksProxyAgent } from "socks-proxy-agent";
import { createWeComBotAdapter } from "@agentor/chat-wecom";

const botId = process.argv[2] ?? "";
const secret = process.argv[3] ?? "";
if (!botId || !secret) { console.error("用法: npx tsx scripts/wecom-test.mts <botId> <secret>"); process.exit(1); }

const proxy = process.env.ALL_PROXY ?? process.env.HTTPS_PROXY;
if (!proxy) { console.error("未检测到代理环境变量（ALL_PROXY/HTTPS_PROXY）"); process.exit(1); }
const proxyUrl = proxy;
const WebSocketCtor = proxyUrl.startsWith("socks") ? class extends WebSocket {
  constructor(url: string) { super(url, { agent: new SocksProxyAgent(proxyUrl) }); }
} : WebSocket;

const adapter = createWeComBotAdapter({ botId, secret, WebSocket: WebSocketCtor as unknown as NonNullable<Parameters<typeof createWeComBotAdapter>[0]>["WebSocket"] });
const testAdapter = adapter as unknown as {
  initialize(opts: { processMessage: () => Promise<void> }): Promise<void>;
  disconnect(): Promise<void>;
};
const timer = setTimeout(() => { console.error("❌ 超时：30 秒未建立连接"); process.exit(2); }, 30_000);
try {
  await testAdapter.initialize({ processMessage: async () => {} });
  clearTimeout(timer);
  console.log("✅ 连接成功：aibot_subscribe 认证通过（凭据有效）");
  await new Promise((r) => setTimeout(r, 3000));
  console.log("✅ 保持连接 3 秒无异常");
  await testAdapter.disconnect();
  console.log("✅ 正常断开");
} catch (error) {
  clearTimeout(timer);
  console.log("❌ 连接失败:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
