/**
 * 热绑定运行时：业务专家在 /bots 页绑定/扫码后，立即在 server 进程内
 * 创建独立 Chat 实例（新绑定 adapter + onDirectMessage 中继）并 initialize
 * 上线，无需重启服务。
 *
 * 为什么独立实例：Chat SDK 的 adapter 集合构造时固定（chat 包无动态
 * addAdapter），冷启动 channel（agent/channels/*）的 adapter 集合无法
 * 追加。故热绑定 = 每个新绑定单独 new Chat()，与冷启动 channel 互不
 * 冲突：冷启动只覆盖进程启动前已存在的绑定，startHotBot 只针对进程
 * 启动后新增的绑定。
 *
 * 双 poller 防护（三层）：
 *   1. 本进程内 hotBotChats Map：同一 botKey 幂等
 *   2. 本进程内冷启动占用检查（isPolledByColdStart，读 globalThis active 引用）
 *   3. 跨进程互斥 acquirePoller（SQLite bot_pollers 表）：冷启动 channel 在
 *      eve dev server 进程、热绑定在本进程，各自 globalThis 互不可见，
 *      必须落库互斥，否则同 bot 双 poller 抢消息 → 一条消息两次回复。
 */
import path from "node:path";
import type { Adapter, Message, Thread } from "chat";
import { Chat } from "chat";
import { createWeComBotAdapter } from "@agentor/chat-wecom";
import { createWeChatAcpAdapter } from "chat-adapter-wechat";
import { SocksProxyAgent } from "socks-proxy-agent";
import WebSocket from "ws";
import { releasePoller, touchActivity, updateConnection } from "@agent/lib/platform/web/bot-bindings/db";
import { relayToEve } from "@agent/lib/platform/web/bot-bindings/eve-relay";
import { acquirePoller } from "@agent/lib/platform/web/bot-bindings/poller-guard";
import { createChannelState } from "@agent/lib/platform/web/bot-bindings/state";
import type { BotBinding } from "@agent/lib/platform/web/bot-bindings/types";

const ROOT = path.resolve(process.cwd());

/** botKey：`wechat:bot_${id}` / `wecom:bot_${id}`（与 findBindingIdByAdapterKey 的解析格式一致）。 */
export function botKeyFor(binding: Pick<BotBinding, "platform" | "id">): string {
  return `${binding.platform}:bot_${binding.id}`;
}

// globalThis 单例：eve dev 热重载会重新执行模块，Map 挂 globalThis 防丢失/防重复轮询
const g = globalThis as unknown as { __hotBotChats?: Map<string, Chat> };
const hotBotChats = (g.__hotBotChats ??= new Map<string, Chat>());

/**
 * 企业微信 WS 走代理（同 agent/channels/wecom.ts）：Node 默认 WebSocket
 * 不读代理环境变量，直连会被网络拦截。有 ALL_PROXY/HTTPS_PROXY 时用
 * ws + socks-proxy-agent 封装 WebSocket 类传给 adapter。
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

/** 按绑定构造 adapter；凭据不完整返回 null。 */
function buildAdapter(binding: BotBinding): Adapter | null {
  if (binding.platform === "wecom") {
    if (!binding.botId || !binding.secret) return null;
    // ws 类型与 adapter 的 WebSocket 选项结构不匹配，运行时正确即可
    type WecomOptions = NonNullable<Parameters<typeof createWeComBotAdapter>[0]>;
    const WeComWebSocket = proxyWebSocketCtor() as unknown as NonNullable<WecomOptions["WebSocket"]>;
    return createWeComBotAdapter({ botId: binding.botId, secret: binding.secret, WebSocket: WeComWebSocket });
  }
  // wechat：accountDir 由 actions.ts 写入绝对路径；兼容相对路径兜底
  if (!binding.accountDir) return null;
  return createWeChatAcpAdapter({
    botId: binding.name,
    dataDir: path.isAbsolute(binding.accountDir) ? binding.accountDir : path.join(ROOT, binding.accountDir),
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

/** 入站消息统一中继：eve 会话 → 回复文本 → thread.post 回发（同冷启动 channel 模式）。 */
function relayHandler(binding: BotBinding) {
  const key = botKeyFor(binding);
  return (thread: Thread, message: Message): void => {
    touchActivity(binding.id);
    void (async () => {
      try {
        const reply = await relayToEve(thread.id, message.text, key);
        await thread.post(reply);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await thread.post(`处理出错：${detail}`).catch(() => {});
        console.error(`[hot-runtime:${key}] 中继失败:`, detail);
      }
    })();
  };
}

/**
 * 冷启动 channel 占用检查：agent/channels/wechat.ts / wecom.ts 启动时把
 * 当前活跃 channel 的 adapter key 组合（逗号分隔）记入 globalThis active
 * 引用。同一 botKey 若已被冷启动 channel 轮询（同进程），热绑定不得重复
 * 启动（防双 poller 抢消息）。
 * 注意：跨进程的冷启动占用由 acquirePoller（SQLite bot_pollers）检查，
 * 本检查只兜同进程（eve dev 热重载后 active 引用仍在）。
 */
function isPolledByColdStart(binding: BotBinding): boolean {
  const key = botKeyFor(binding);
  const started = globalThis as unknown as {
    __wechatChannelActive?: { keyList?: string } | null;
    __wecomChannelActive?: { keyList?: string } | null;
    // 兼容旧版本代码热重载过渡期的 Set 形式
    __wechatPollingStarted?: Set<string>;
    __wecomPollingStarted?: Set<string>;
  };
  for (const active of [started.__wechatChannelActive, started.__wecomChannelActive]) {
    if (active?.keyList && active.keyList.split(",").includes(key)) return true;
  }
  for (const set of [started.__wechatPollingStarted, started.__wecomPollingStarted]) {
    if (!set) continue;
    for (const entry of set) {
      if (entry.split(",").includes(key)) return true;
    }
  }
  return false;
}

/**
 * 创建热绑定 Chat 实例（构造 adapter + 注册中继 handler），不启动轮询。
 * 凭据不完整返回 null。拆分导出：启动前的构造可独立验证/复用。
 */
export function createHotChat(binding: BotBinding): Chat | null {
  const adapter = buildAdapter(binding);
  if (!adapter) return null;
  const chat = new Chat({ userName: "经营分析助手", adapters: { [botKeyFor(binding)]: adapter }, state: createChannelState() });
  const handler = relayHandler(binding);
  chat.onDirectMessage(handler);
  if (binding.platform === "wecom") {
    // 企微群聊需 @提及 或 回复订阅线程（同冷启动 channel）
    chat.onNewMention(handler);
    chat.onSubscribedMessage(handler);
  }
  return chat;
}

/**
 * 启动热绑定 bot：创建独立 Chat 实例并 initialize 上线。
 * 幂等：同一 botKey 已在运行（热绑定或冷启动 channel）则跳过，防重复轮询。
 * 启动失败时回写绑定为 failed（成功状态回写由调用方负责，便于带上 bot 身份信息）。
 */
export async function startHotBot(binding: BotBinding): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = botKeyFor(binding);
  if (hotBotChats.has(key)) {
    return { ok: false, reason: `bot ${key} 已在热绑定运行中` };
  }
  if (isPolledByColdStart(binding)) {
    return { ok: false, reason: `bot ${key} 已由冷启动 channel 接管（服务启动前已存在的绑定），无需热绑定` };
  }
  // 跨进程互斥：冷启动 channel 在 eve dev server 进程（不同 globalThis），
  // 其轮询记录在 SQLite bot_pollers——被占用则放弃热绑定，避免双 poller 双回复
  if (!acquirePoller(key)) {
    return { ok: false, reason: `bot ${key} 已被其他进程 poller 占用（冷启动 channel），无需热绑定` };
  }
  const chat = createHotChat(binding);
  if (!chat) {
    releasePoller(key);
    return { ok: false, reason: "凭据不完整（wecom 需 botId+secret；wechat 需 accountDir）" };
  }

  try {
    await chat.initialize();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[hot-runtime:${key}] 初始化失败:`, detail);
    releasePoller(key);
    try {
      updateConnection(binding.id, { status: "failed", connectedInfo: { platform: binding.platform, note: `热绑定启动失败：${detail}` } });
    } catch {
      /* 绑定表不可写时忽略 */
    }
    return { ok: false, reason: detail };
  }

  hotBotChats.set(key, chat);
  console.log(`[hot-runtime] ${key}（${binding.name}）热绑定已上线，立即生效（无需重启）`);
  return { ok: true };
}

/** 当前热绑定运行实例的 botKey 列表（日志/管理用）。 */
export function hotBotKeys(): string[] {
  return [...hotBotChats.keys()];
}

/** botKey 是否已有热绑定实例在运行。 */
export function isHotBotRunning(binding: Pick<BotBinding, "platform" | "id">): boolean {
  return hotBotChats.has(botKeyFor(binding));
}
