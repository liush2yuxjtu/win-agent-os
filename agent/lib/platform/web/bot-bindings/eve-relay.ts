/**
 * eve 会话中继：供长轮询/WS 类 bot（微信 iLink、企业微信）的入站消息使用。
 *
 * 为什么需要：chatSdkChannel 的 send() 只能在 eve webhook 路由上下文调用，
 * 微信/企微没有 webhook（轮询/WS 长连接），handler 里调 send 必然抛错。
 * 本模块直接调 eve Client SDK（同源 HTTP /eve/v1/session），完成：
 *   入站消息 → 创建/续会话 → 收集回复文本 → 返回给 bot 回发。
 *
 * HITL（ask_question/审批）：事件流出现 input.requested 时，把 prompt+选项
 * 文本返回给用户；用户下一条消息发到同一会话，文本命中选项 ID/标签/序号
 * 会被 eve 自动解析（无需卡片）。
 *
 * 会话映射：`${botKey}:${threadId}` → sessionId 持久化到 SQLite（bot_sessions
 * 表，见 ./db），服务重启后对话上下文不丢；进程内存 Map 仅作读缓存。
 * botKey 参与 key：同一用户在不同 bot（如 bot-123 与 abc）各自独立 eve 会话，
 * 上下文互不串。
 */
import { Client, ClientSession } from "eve/client";
import { recordBotMessage } from "../chat-sessions/db";
import { cleanupStaleSessions, countSessions, getSession, sessionKeyFor, setSession, touchSession } from "./db";

const HOST = process.env.EVE_INTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const eveClient = new Client({ host: HOST });

/** 缓存的会话对象：attach 后复用同一对象，其内部 streamIndex 自动推进，send 只读新事件。 */
const sessionMap = new Map<string, ClientSession>();

/**
 * 同一会话的 relay 串行队列：并发 send（用户连发消息）时，第二个 send 的事件流会从
 * streamIndex=0 重放第一个 turn 的历史并在其 waiting 处提前结束，拿到第一条的回复
 * （实测复现）。串行化保证每个 send 在前一个 turn 完成后开始，流位置正确、回复对应。
 */
const sessionQueues = new Map<string, Promise<void>>();

function enqueueSessionTask<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = sessionQueues.get(key) ?? Promise.resolve();
  const result = prev.then(task, task); // 前一个失败也不阻塞下一个
  sessionQueues.set(key, result.then(() => undefined, () => undefined));
  return result;
}

/** 约 1% 概率触发一次过期会话清理，避免每次消息都扫库；失败不影响转发。 */
function maybeCleanupStaleSessions(): void {
  if (Math.random() < 0.01) {
    try {
      cleanupStaleSessions(7);
    } catch (err) {
      console.error("[eve-relay] 清理过期会话失败：", err);
    }
  }
}

function assistantText(message: unknown): string {
  const m = message as { text?: string; content?: unknown[] };
  if (typeof m?.text === "string" && m.text.length > 0) return m.text;
  // AI SDK message content parts 兜底
  if (Array.isArray(m?.content)) {
    return m.content
      .map((part) => {
        const p = part as { type?: string; text?: string };
        return p.type === "text" && typeof p.text === "string" ? p.text : "";
      })
      .join("");
  }
  return "";
}

/** 回复流兜底超时（毫秒）：eve 事件流在复杂 turn 后可能因边界事件（session.waiting）
 * 丢失而永不结束——实测「供应链风险问题」处理完成后 relay 挂起 90 秒不返回，
 * thread.post 永不执行，用户静默收不到任何回复。超时后抛错，由 channel 侧回发错误提示。
 * 默认 10 分钟：留足复杂任务（多轮工具调用、看板生成等）的处理余量。 */
const REPLY_TIMEOUT_MS = Number(process.env.EVE_RELAY_TIMEOUT_MS ?? 600_000);

/**
 * 从 threadId 提取稳定的会话键片段。
 *
 * iLink 的 thread.id 内嵌 contextToken，每次消息都会变化
 * （`wechat:dm:<用户>@im.wechat:<token>`）。若用完整 threadId 作会话键，每条消息都会
 * 新建 eve 会话、对话上下文全部丢失（同事追问「我刚刚问的什么问题」答不上来的根因）。
 * 这里只保留到 conversationId（用户账号段），同用户同 bot 的消息归入同一会话。
 * 非 wechat 前缀（企微等）原样返回，不受影响。
 */
function conversationKeyOf(threadId: string): string {
  const parts = threadId.split(":");
  if (parts.length >= 3 && parts[0] === "wechat") return parts.slice(0, 3).join(":");
  return threadId;
}

/**
 * attach 会话并把事件游标推进到历史末尾。
 *
 * eve ClientSession 每次 attach 都从 streamIndex=0 读事件流；若直接 send，
 * 流会先重放会话历史（含历史最后一条 assistant 回复和 session.waiting 边界），
 * relay 会把旧回复当本次回复返回（实测 0.0s 返回上一条回复）。这里先消费一遍
 * 历史（follow:false + reconnect:false，失败立即抛错不重试），让内部 streamIndex
 * 推进到当前末尾，后续 send 只读新事件。
 */
async function attachSessionAtTail(sessionId: string): Promise<ClientSession> {
  const session = eveClient.sessions.attach(sessionId);
  for await (const _ of session.stream({ follow: false, streamReconnectPolicy: { reconnect: false } })) {
    // 消费历史事件,推进 streamIndex
  }
  return session;
}

/**
 * 转发一条用户消息到 eve，返回应回发给用户的文本。
 * 会话不存在则创建（botKey+conversationId 首次出现）。
 * @param botKey bot 标识（wechat:bot_7 / wecom:bot_6 / wechat:env）——同一用户
 * 在不同 bot 各自独立会话，互不共享上下文。
 */
export async function relayToEve(threadId: string, text: string, botKey: string): Promise<string> {
  maybeCleanupStaleSessions();
  const sessionKey = sessionKeyFor(botKey, conversationKeyOf(threadId));
  // 同会话串行：用户连发消息时按序处理，避免并发 send 的事件流交错（见 sessionQueues）
  return enqueueSessionTask(sessionKey, () => doRelayToEve(threadId, text, botKey, sessionKey));
}

async function doRelayToEve(threadId: string, text: string, botKey: string, sessionKey: string): Promise<string> {
  const conversationKey = conversationKeyOf(threadId);
  // bot 聊天记录落库（best-effort，失败不阻塞转发）：用户消息先记，回复在出口处补记
  recordBotMessage({ botKey, conversationKey, role: "user", text });
  let session: ClientSession | undefined = sessionMap.get(sessionKey);
  if (!session) {
    const stored = getSession(sessionKey);
    if (stored) {
      session = await attachSessionAtTail(stored.sessionId);
      sessionMap.set(sessionKey, session);
    }
  }

  let response;
  if (session) {
    // turnPolicy=queue：eve 默认 steer 会用新消息打断正在处理的 turn（实测：同事连发
    // 两条消息时，前一条 turn 被 turn.cancelled 取消，只回出半截开场白）。
    // queue 让新消息排队，保证前一条处理完整、回复完整。
    response = await session.send(text, { turnPolicy: "queue" });
    touchSession(sessionKey);
  } else {
    const created = await eveClient.sessions.create({ message: text });
    session = created.session;
    response = created.response;
    sessionMap.set(sessionKey, session);
    setSession(botKey, threadId, session.state.sessionId);
  }

  const replyPromise = (async (): Promise<string> => {
    let reply = "";
    for await (const event of response) {
      if (event.type === "message.appended") {
        const data = event.data as { messageSoFar?: string };
        if (typeof data.messageSoFar === "string" && data.messageSoFar.length > 0) reply = data.messageSoFar;
      } else if (event.type === "message.completed") {
        const data = event.data as { message?: unknown };
        const completed = assistantText(data.message);
        if (completed.length > 0) reply = completed;
      } else if (event.type === "input.requested") {
        // HITL：把询问文本+选项回给用户（回复文本命中选项会自动解析）
        const data = event.data as unknown as { requests?: Array<{ prompt?: string; options?: Array<{ label?: string; id?: string }> }> };
        const first = data.requests?.[0];
        if (first) {
          const options = (first.options ?? []).map((o, i) => `${i + 1}. ${o.label ?? o.id ?? ""}`).join("\n");
          reply = first.prompt ? `${first.prompt}${options ? `\n${options}` : ""}` : "请回复你的选择。";
        }
      } else if (event.type === "turn.failed" || event.type === "session.failed") {
        const data = event.data as { message?: string; code?: string };
        const failedText = `处理出错（${data.code ?? "unknown"}）：${data.message ?? "未知错误"}`;
        recordBotMessage({ botKey, conversationKey, role: "assistant", text: failedText });
        return failedText;
      }
    }
    const finalReply = reply.length > 0 ? reply : "（没有可展示的回复）";
    recordBotMessage({ botKey, conversationKey, role: "assistant", text: finalReply });
    return finalReply;
  })();

  // 兜底超时：流永不结束时（见 REPLY_TIMEOUT_MS 注释）不再无限等待，
  // 抛错让 channel 侧回发「处理出错」提示，避免用户静默无回复。
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`eve 回复超时（${Math.round(REPLY_TIMEOUT_MS / 1000)} 秒未等到回复流结束）`)),
      REPLY_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([replyPromise, timeoutPromise]);
  } catch (error) {
    // 超时/流异常：回发错误提示给用户，同时把错误记录进聊天历史（复盘静默丢失的依据）
    const detail = error instanceof Error ? error.message : String(error);
    recordBotMessage({ botKey, conversationKey, role: "assistant", text: `处理出错：${detail}` });
    throw error;
  }
}

/** 供测试/管理用：当前持久化的会话映射数。 */
export function relaySessionCount(): number {
  return countSessions();
}
