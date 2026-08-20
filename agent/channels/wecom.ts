/**
 * 渠道 metadata 投影说明（eve 0.38.3 recon 结论）：
 *
 * 本渠道基于 chatSdkChannel，无法按计划添加 metadata(state) 投影：
 * ChatSdkChannelConfig 不暴露 `metadata` 配置项——eve 的 chat-sdk 桥在内部
 * defineChannel 时把 metadata 投影硬编码为 ChatSdkInstrumentationMetadata
 * `{ adapterName, channelId, isDM, threadId }`（其中 channelId 是平台侧
 * 线程/会话 id，不是渠道标识），配置层无法覆盖，故投影不出 { channelId: 'wecom' }。
 *
 * 替代方案（供 dynamic resolver 读取，如 agent/skills/visibility.ts）：
 *   - ctx.channel.kind === "channel:wecom" —— 本渠道唯一。eve 在
 *     runtime/resolve-channel.ts 把非 http 的 authored channel adapter kind
 *     重写为 `channel:<文件路由名>`（wechat 为 "channel:wechat"，web 为 "http"）。
 *   - ctx.channel.metadata.adapterName —— 运行时已由 chat-sdk 桥注入，形如
 *     "wecom:bot_6" / "wecom:env"，以 "wecom:" 前缀兜底识别本渠道。
 */
/**
 * 企业微信 bot channel（Chat SDK 桥，智能机器人 WebSocket 模式）。
 *
 * - WeCom Smart Bot WebSocket 长连接：无需公网回调 URL，本地即可运行
 * - **现场绑定**：业务专家在 webapp「机器人接入」填 Bot ID + Secret → 绑定表
 *   （lib/bot-bindings）→ 本 channel 启动时读表构造 adapter（支持多 bot）。
 *   绑定后需重启服务生效（Chat SDK adapter 集合构造时固定）。
 * - env 兜底：未配置绑定表时回退 WECOM_BOT_WS_BOT_ID / WECOM_BOT_WS_SECRET
 * - 创建：企业微信管理后台 → 应用管理 → 智能机器人
 */
import type { Adapter, Message, Thread } from "chat";
import { SocksProxyAgent } from "socks-proxy-agent";
import WebSocket from "ws";
import { createWeComBotAdapter } from "@agentor/chat-wecom";
import { chatSdkChannel } from "eve/channels/chat-sdk";
import { findBindingIdByAdapterKey, getActiveBindings, getBindingById, isUserAllowed, setLastThread, touchActivity } from "../lib/platform/web/bot-bindings/db";
import { relayToEve } from "../lib/platform/web/bot-bindings/eve-relay";
import { acquirePoller } from "../lib/platform/web/bot-bindings/poller-guard";
import { createChannelState } from "../lib/platform/web/bot-bindings/state";

/**
 * 企业微信 WS 走代理：Node 默认 WebSocket 不读代理环境变量，直连会被网络
 * 拦截（实测 socks5h://127.0.0.1:7897 可通）。有 ALL_PROXY/HTTPS_PROXY 时
 * 用 ws + socks-proxy-agent 封装 WebSocket 类传给 adapter。
 */
function proxyWebSocketCtor(): typeof WebSocket {
  const proxy = process.env.ALL_PROXY ?? process.env.HTTPS_PROXY;
  if (!proxy) return WebSocket;
  // ws 的构造签名与自定义子类不兼容，用断言绕过（运行时不涉及类型）
  return class extends WebSocket {
    constructor(url: string) {
      super(url, { agent: new SocksProxyAgent(proxy!) });
    }
  } as unknown as typeof WebSocket;
}
// ws 类型与 adapter 的 WebSocket 选项结构不匹配，运行时正确即可
type WecomOptions = NonNullable<Parameters<typeof createWeComBotAdapter>[0]>;
const WeComWebSocket: NonNullable<WecomOptions["WebSocket"]> = proxyWebSocketCtor() as unknown as NonNullable<WecomOptions["WebSocket"]>;

// 启动时读绑定表（构建期求值可能无库，容错为空）
let boundAdapters: Record<string, Adapter> = {};
try {
  for (const binding of getActiveBindings("wecom")) {
    if (!binding.botId || !binding.secret) continue;
    const key = `wecom:bot_${binding.id}`;
    // 跨进程互斥：已被其他进程 poller（热绑定实例）占用则跳过，防双 poller 双回复
    if (!acquirePoller(key)) {
      console.warn(`[wecom] ${key} 已被其他进程 poller 占用，冷启动跳过（由占用方接管）`);
      continue;
    }
    // adapter key 用 bot_${id}：绑定名（中文/连字符）会产生非法正则命名组
    boundAdapters[key] = createWeComBotAdapter({
      botId: binding.botId,
      secret: binding.secret,
      WebSocket: WeComWebSocket,
    });
  }
} catch {
  boundAdapters = {};
}

const envBotId = process.env.WECOM_BOT_WS_BOT_ID;
const envSecret = process.env.WECOM_BOT_WS_SECRET;

if (Object.keys(boundAdapters).length === 0 && envBotId && envSecret) {
  if (acquirePoller("wecom:env")) {
    boundAdapters.wecom = createWeComBotAdapter({ botId: envBotId, secret: envSecret, WebSocket: WeComWebSocket });
  }
}

if (Object.keys(boundAdapters).length === 0) {
  console.warn("[wecom] 无企业微信绑定（绑定表为空且未配置 env），channel 未挂载任何 bot");
}

export const { bot, channel, send } = chatSdkChannel({
  userName: "经营分析助手",
  adapters: boundAdapters,
  state: createChannelState(),
});

export default channel;

// chatSdkChannel 只挂 webhook 路由，不启动 adapter——WeCom WS 长连接需显式
// initialize。模块加载即启动；构建期 evaluate 失败仅告警。
// 单轮询保护（两层）：globalThis active 引用防热重载重复连接（集合变化先
// shutdown 旧 bot）；跨进程互斥由 acquirePoller（SQLite bot_pollers）完成。
const g = globalThis as unknown as {
  __wecomChannelActive?: { chat: typeof bot; keyList: string } | null;
  // 兼容旧版本代码热重载过渡期的 Set 形式（isPolledByColdStart 兜底读取）
  __wecomPollingStarted?: Set<string>;
};
const keyList = Object.keys(boundAdapters).sort().join(",");
if (keyList) {
  void (async () => {
    let prev = g.__wecomChannelActive;
    if (!prev && g.__wecomPollingStarted && g.__wecomPollingStarted.size > 0) {
      // 从旧版本代码（Set 防重）热重载过渡：旧连接无引用可回收，沿用不重复
      // initialize（否则双连接抢消息 → 双回复）；重启后切换。占位 active 供
      // hot-runtime 冷启动占用检查。
      console.warn("[wecom] 检测到旧版本连接（热重载过渡期），沿用旧连接；重启服务后切换到新互斥逻辑");
      g.__wecomChannelActive = { chat: bot, keyList };
      return;
    }
    if (prev && prev.keyList !== keyList) {
      // 绑定集合变化（新增/解绑后热重载）：旧 bot 还在连旧集合，先停掉再起新的
      try {
        await prev.chat.shutdown();
        console.log(`[wecom] 绑定集合变化（${prev.keyList} → ${keyList}），已回收旧连接`);
      } catch (error) {
        console.error("[wecom] 旧 channel shutdown 失败（忽略）:", error instanceof Error ? error.message : String(error));
      }
      g.__wecomChannelActive = null;
    }
    if (g.__wecomChannelActive) return; // 同集合热重载：旧连接继续，不重复启动
    const chat = bot;
    g.__wecomChannelActive = { chat, keyList };
    try {
      await chat.initialize();
      console.log(`[wecom] 已连接（${Object.keys(boundAdapters).length} 个 bot）`);
    } catch (error) {
      g.__wecomChannelActive = null;
      console.error("[wecom] 初始化失败:", error instanceof Error ? error.message : String(error));
    }
  })();
}

/** 收到消息时回写绑定表的最后活跃时间（按 adapter key 定位绑定），并走 eve 中继。 */
function onInbound(thread: Thread, message: Message) {
  // Chat SDK Message 在运行时携带 adapter 标识，但 eve 编译类型未覆盖，断言读取
  const raw = message as unknown as { adapter?: { name?: string } | string };
  const key = typeof raw.adapter === "string" ? raw.adapter : String(raw.adapter?.name ?? "");
  // botKey 参与会话隔离：同一用户在不同 bot 各自独立 eve 会话
  const botKey = key || "wecom:env";
  const bindingId = findBindingIdByAdapterKey(key);
  const binding = bindingId != null ? getBindingById(bindingId) : undefined;
  if (bindingId != null) {
    touchActivity(bindingId);
    setLastThread(bindingId, thread.id);
  }
  void (async () => {
    try {
      // 白名单：绑定配置了 allowedUsers 且不含发送者（message.author.userId，企微为
      // 用户 userid）→ 拒绝并跳过中继
      if (binding && !isUserAllowed(binding, message.author.userId)) {
        await thread.post("抱歉，您暂无使用权限。");
        return;
      }
      // typing indicator：企微 WS adapter 的 startTyping 为 no-op（平台不支持），
      // 调用无害；成功后亦无 stopTyping API，靠平台超时消失。
      await thread.startTyping("正在分析…").catch(() => {});
      const reply = await relayToEve(thread.id, message.text, botKey);
      await thread.post(reply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await thread.post(`处理出错：${detail}`).catch(() => {});
      console.error("[wecom] 中继失败:", detail);
    }
  })();
}

// 私聊直接对话；群聊需 @提及 或 回复订阅线程
bot.onDirectMessage((thread: Thread, message: Message) => {
  onInbound(thread, message);
});
bot.onNewMention((thread: Thread, message: Message) => {
  onInbound(thread, message);
});
bot.onSubscribedMessage((thread: Thread, message: Message) => {
  onInbound(thread, message);
});
