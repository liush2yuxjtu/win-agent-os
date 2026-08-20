/**
 * 渠道 metadata 投影说明（eve 0.38.3 recon 结论）：
 *
 * 本渠道基于 chatSdkChannel，无法按计划添加 metadata(state) 投影：
 * ChatSdkChannelConfig 不暴露 `metadata` 配置项——eve 的 chat-sdk 桥在内部
 * defineChannel 时把 metadata 投影硬编码为 ChatSdkInstrumentationMetadata
 * `{ adapterName, channelId, isDM, threadId }`（其中 channelId 是平台侧
 * 线程/会话 id，不是渠道标识），配置层无法覆盖，故投影不出 { channelId: 'wechat' }。
 *
 * 替代方案（供 dynamic resolver 读取，如 agent/skills/visibility.ts）：
 *   - ctx.channel.kind === "channel:wechat" —— 本渠道唯一。eve 在
 *     runtime/resolve-channel.ts 把非 http 的 authored channel adapter kind
 *     重写为 `channel:<文件路由名>`（wecom 为 "channel:wecom"，web 为 "http"）。
 *   - ctx.channel.metadata.adapterName —— 运行时已由 chat-sdk 桥注入，形如
 *     "wechat:bot_7" / "wechat:env"，以 "wechat:" 前缀兜底识别本渠道。
 */
/**
 * 微信 bot channel（Chat SDK 桥，iLink ACP 模式）。
 *
 * - iLink bot：微信官方机器人 API（1:1 私聊），QR 扫码登录 + 长轮询，无需公网回调
 * - **现场绑定**：业务专家在 webapp「机器人接入」扫码 → 凭据存入绑定表
 *   （lib/bot-bindings，accountDir 指向凭据目录）→ 本 channel 启动时按绑定
 *   构造 adapter（多 bot 网关）。绑定后需重启服务生效。
 * - env 兜底：未配置绑定表时回退 WEIXIN_ACCOUNT_ID / WEIXIN_BOT_TOKEN
 *
 * 环境变量（.env.local）：
 *   WEIXIN_ACCOUNT_ID / WEIXIN_BOT_TOKEN  iLink 凭据（`weixin-chat-adapter login --env` 扫码获取）
 */
import type { Adapter, Message, Thread } from "chat";
import path from "node:path";
import { createWeChatAcpAdapter } from "chat-adapter-wechat";
import { chatSdkChannel } from "eve/channels/chat-sdk";
import { findBindingIdByAdapterKey, getActiveBindings, getBindingById, isUserAllowed, setLastThread, touchActivity, updateConnection } from "../lib/platform/web/bot-bindings/db";
import { relayToEve } from "../lib/platform/web/bot-bindings/eve-relay";
import { acquirePoller } from "../lib/platform/web/bot-bindings/poller-guard";
import { createChannelState } from "../lib/platform/web/bot-bindings/state";
import { getAgentPaths } from "../platform";

// 启动时读绑定表（构建期求值可能无库，容错为空）
let boundAdapters: Record<string, Adapter> = {};
try {
  for (const binding of getActiveBindings("wechat")) {
    if (!binding.accountDir) continue;
    const key = `wechat:bot_${binding.id}`;
    // 跨进程互斥：已被其他进程 poller（热绑定实例在 next-server 进程）占用则跳过，
    // 否则同一条消息被拉两次、各回一次（双回复）。热重载同进程内由 active 引用兜底。
    if (!acquirePoller(key)) {
      console.warn(`[wechat] ${key} 已被其他进程 poller 占用，冷启动跳过（由占用方接管）`);
      continue;
    }
    // adapter key 用 bot_${id}：eve 用 key 生成路由正则的命名捕获组，
    // 绑定名（中文/连字符/数字开头）会产生非法命名组导致 server 崩溃
    boundAdapters[key] = createWeChatAcpAdapter({
      botId: binding.name,
      dataDir: path.isAbsolute(binding.accountDir) ? binding.accountDir : path.join(getAgentPaths().repoRoot, binding.accountDir),
      // iLink 401/403（token 过期/被撤销）→ 停止轮询并回写绑定为失败，引导重新扫码
      onAuthFailure: () => {
        try {
          updateConnection(binding.id, { status: "failed", connectedInfo: { platform: "wechat", note: "登录过期，请重新扫码" } });
        } catch {
          /* 绑定表不可写时忽略 */
        }
      },
    });
  }
} catch {
  boundAdapters = {};
}

// env 兜底（单 bot）
const envAccountId = process.env.WEIXIN_ACCOUNT_ID;
const envToken = process.env.WEIXIN_BOT_TOKEN;
if (Object.keys(boundAdapters).length === 0 && envAccountId && envToken) {
  if (acquirePoller("wechat:env")) {
    boundAdapters.wechat = createWeChatAcpAdapter();
  }
}

if (Object.keys(boundAdapters).length === 0) {
  console.warn("[wechat] 无微信绑定（绑定表为空且未配置 env），channel 未挂载任何 bot");
}

export const { bot, channel, send } = chatSdkChannel({
  userName: "经营分析助手",
  adapters: boundAdapters,
  state: createChannelState(),
});

export default channel;

// chatSdkChannel 只挂 webhook 路由，不启动 adapter——微信是长轮询（无 webhook），
// 必须显式 initialize 才会上线。模块加载即启动；构建期 evaluate 失败仅告警。
// 单轮询保护（两层层）：
//   1. globalThis 记录「当前活跃 channel」——eve dev 热重载会重新执行模块，
//      同集合直接沿用旧 poller；集合变化先 shutdown 旧 bot 再初始化新的，
//      防止增量绑定/解绑时旧 poller 不回收导致双 poller 抢消息。
//   2. 跨进程互斥由 acquirePoller（SQLite bot_pollers 表）在构造 adapter 时完成。
const g = globalThis as unknown as {
  __wechatChannelActive?: { chat: typeof bot; keyList: string } | null;
  // 兼容旧版本代码热重载过渡期的 Set 形式（isPolledByColdStart 兜底读取）
  __wechatPollingStarted?: Set<string>;
};
const keyList = Object.keys(boundAdapters).sort().join(",");
if (keyList) {
  void (async () => {
    let prev = g.__wechatChannelActive;
    if (!prev && g.__wechatPollingStarted && g.__wechatPollingStarted.size > 0) {
      // 从旧版本代码（Set 防重）热重载过渡：旧 poller 无引用可回收，沿用旧连接；
      // 不重复 initialize（否则双 poller 抢消息 → 一条消息两次回复）；重启后切换。
      // 用新 bot 占位 active 引用，供 hot-runtime 冷启动占用检查。
      console.warn("[wechat] 检测到旧版本 poller（热重载过渡期），沿用旧连接；重启服务后切换到新互斥逻辑");
      g.__wechatChannelActive = { chat: bot, keyList };
      return;
    }
    if (prev && prev.keyList !== keyList) {
      // 绑定集合变化（新增/解绑后热重载）：旧 bot 还在轮询旧集合，先停掉再起新的
      try {
        await prev.chat.shutdown();
        console.log(`[wechat] 绑定集合变化（${prev.keyList} → ${keyList}），已回收旧 poller`);
      } catch (error) {
        console.error("[wechat] 旧 channel shutdown 失败（忽略）:", error instanceof Error ? error.message : String(error));
      }
      g.__wechatChannelActive = null;
    }
    if (g.__wechatChannelActive) return; // 同集合热重载：旧 poller 继续，不重复启动
    const chat = bot;
    g.__wechatChannelActive = { chat, keyList };
    try {
      await chat.initialize();
      console.log(`[wechat] 轮询已启动（${Object.keys(boundAdapters).length} 个 bot）`);
    } catch (error) {
      g.__wechatChannelActive = null;
      console.error("[wechat] 初始化失败:", error instanceof Error ? error.message : String(error));
    }
  })();
}

// iLink bot 仅支持 1:1 私聊：直接消息即会话。
// 注意：不用 chatSdkChannel 的 send（仅限 webhook 上下文），走 eve Client SDK 中继。
bot.onDirectMessage((thread: Thread, message: Message) => {
  // Chat SDK Message 在运行时携带 adapter 标识，但 eve 编译类型未覆盖，断言读取
  const raw = message as unknown as { adapter?: { name?: string } | string };
  const key = typeof raw.adapter === "string" ? raw.adapter : String(raw.adapter?.name ?? "");
  // botKey 参与会话隔离：同一用户在不同 bot 各自独立 eve 会话
  const botKey = key || "wechat:env";
  const bindingId = findBindingIdByAdapterKey(key);
  const binding = bindingId != null ? getBindingById(bindingId) : undefined;
  if (bindingId != null) {
    touchActivity(bindingId);
    setLastThread(bindingId, thread.id);
  }
  void (async () => {
    try {
      // 白名单：绑定配置了 allowedUsers 且不含发送者（message.author.userId，iLink 为
      // fromUserId，如 o9cq804lWYJALneYWmWVzbnZUoYo@im.wechat）→ 拒绝并跳过中继
      if (binding && !isUserAllowed(binding, message.author.userId)) {
        await thread.post("抱歉，您暂无使用权限。");
        return;
      }
      // typing indicator：iLink 支持（adapter 向平台发送 typing 事件）；无 stopTyping
      // API，靠平台超时消失。失败（如无 typing_ticket）不影响主流程。
      await thread.startTyping("正在分析…").catch(() => {});
      const reply = await relayToEve(thread.id, message.text, botKey);
      await thread.post(reply);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await thread.post(`处理出错：${detail}`).catch(() => {});
      console.error("[wechat] 中继失败:", detail);
    }
  })();
});
