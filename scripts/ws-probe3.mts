import WebSocket from "ws";
import { SocksProxyAgent } from "socks-proxy-agent";
const agent = new SocksProxyAgent("socks5h://127.0.0.1:7897");
const ws = new WebSocket("wss://openws.work.weixin.qq.com", { agent });
const timer = setTimeout(() => { console.log("❌ 超时"); process.exit(2); }, 12_000);
ws.on("open", () => { clearTimeout(timer); console.log("✅ 经代理 WS 握手成功"); ws.close(); process.exit(0); });
ws.on("error", (e) => { clearTimeout(timer); console.log("❌", e.message); process.exit(1); });
