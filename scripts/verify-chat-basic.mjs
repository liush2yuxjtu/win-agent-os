#!/usr/bin/env node
/**
 * 聊天链路 E2E 冒烟测试（真实浏览器 + 真实 eve 会话 + 历史落库/恢复断言）。
 *
 * 用法：
 *   PORT=3000 node scripts/verify-chat-basic.mjs
 *   PORT=3111 node scripts/verify-chat-basic.mjs
 *
 * 成功：exit 0，stdout 打印一行 JSON 摘要（含 sessionId / 历史落库 / 恢复 / 清理结果）。
 * 失败：exit 1，stdout 打印 JSON 诊断。
 */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.PORT || 3000);
const BASE = `http://127.0.0.1:${PORT}`;
const MESSAGE = "请只回复四个字：收到，好的";
const SEND_TEXT_TIMEOUT_MS = 120_000;
const RESTORE_TIMEOUT_MS = 60_000;
const NAV_TIMEOUT_MS = 60_000;

const summary = {
  ok: false,
  port: PORT,
  base: BASE,
  message: MESSAGE,
  sessionId: null,
  title: null,
  assistantReply: null,
  /** assistant 回复是否已随 POST /api/chat-sessions 落库（网络信号，权威回复判定）。 */
  assistantSynced: false,
  /** 最后一次落库 POST 携带的消息 role 序列（如 ["user","assistant"]）。 */
  syncedRoles: null,
  pathAfterSend: null,
  historyListed: false,
  historyContainsSession: false,
  historyFields: null,
  restoreVerified: false,
  cleanupAttempted: false,
  cleanupOk: false,
  pageErrors: [],
  consoleErrors: [],
  startedAt: new Date().toISOString(),
  durationMs: null,
};

const startedAt = Date.now();

/** 过滤 devtools 遥测 404/403 与 HMR websocket 噪音。 */
function isFilteredNoise(text) {
  if (!text) return false;
  const t = String(text);
  // Next devtools / telemetry 资源 404/403
  if (/(devtools|telemetry|__next_devtools__|next-devtools)/i.test(t) && /(404|403|failed to load resource)/i.test(t)) return true;
  // HMR websocket 噪音
  if (/(webpack-hmr|websocket connection to)/i.test(t) && /(failed|closed|error|did not receive|connection)/i.test(t)) return true;
  if (/webpack-hmr/i.test(t)) return true;
  // favicon 缺失等纯静态资源 404 噪音（页面无 favicon 定义时 Chrome 会请求 /favicon.ico）。
  // headless 下 console 消息常不带 URL，无法区分来源；4xx 由下方 response 监听
  // 按 URL 精确记录（favicon 404 除外），此处一律放行纯 404 加载失败消息。
  if (/failed to load resource/i.test(t) && /404/i.test(t)) return true;
  return false;
}

function fail(reason, extra = {}) {
  summary.ok = false;
  summary.failReason = reason;
  Object.assign(summary, extra);
  summary.durationMs = Date.now() - startedAt;
  console.log(JSON.stringify(summary, null, 2));
  process.exit(1);
}

function pass() {
  summary.ok = true;
  summary.durationMs = Date.now() - startedAt;
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

function bodyText(page) {
  return page.evaluate(() => document.body?.innerText ?? "");
}

async function pollForTextGrowth(page, baseline, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = baseline;
  while (Date.now() < deadline) {
    const current = await bodyText(page);
    if (current.length > baseline.length + 4) {
      return { ok: true, text: current, added: current.slice(baseline.length), elapsedMs: timeoutMs - (deadline - Date.now()) };
    }
    last = current;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return { ok: false, text: last, added: "", elapsedMs: timeoutMs };
}

/** 从落库消息 content（JSON string，EveMessage.parts）中提取纯文本。解析失败返回空串。 */
function extractAssistantText(content) {
  try {
    const parts = JSON.parse(content);
    if (!Array.isArray(parts)) return "";
    return parts
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join(" ")
      .trim();
  } catch {
    return "";
  }
}

/**
 * 监听 POST /api/chat-sessions：turn 结束（status ready/error + 150ms）前端才发全量
 * 消息同步，因此该请求出现 role=assistant 即权威证明「回复完成且已落库」——
 * 比 body 文本增长可靠（错误横幅/加载提示等噪音也会增长）。
 */
function attachSyncProbe(page, summaryRef) {
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().includes("/api/chat-sessions")) return;
    let body;
    try {
      body = JSON.parse(req.postData() ?? "{}");
    } catch {
      return;
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) return;
    summaryRef.syncedRoles = messages.map((m) => m.role);
    const assistant = messages.find((m) => m.role === "assistant");
    if (assistant) {
      summaryRef.assistantSynced = true;
      const text = extractAssistantText(String(assistant.content ?? ""));
      if (text && !summaryRef.assistantReply) summaryRef.assistantReply = text.slice(0, 200);
    }
  });
}

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on("pageerror", (e) => {
    const text = String(e);
    if (!isFilteredNoise(text)) summary.pageErrors.push(text);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (!isFilteredNoise(text)) summary.consoleErrors.push(text);
  });
  // 4xx 按 URL 精确记录（favicon 404 噪音除外）——headless 下 console 404 消息
  // 不带 URL，无法过滤，以 response 事件为准。
  page.on("response", (r) => {
    if (r.status() >= 400) {
      const u = r.url();
      if (!/favicon\.ico/.test(u) && !isFilteredNoise(`http${r.status()} ${u}`)) {
        summary.consoleErrors.push(`[http${r.status()}] ${u}`);
      }
    }
  });
  attachSyncProbe(page, summary);

  // 1. 打开新会话深链，等待 textarea 就绪
  await page.goto(`${BASE}/chat/new`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector('textarea[name="message"]', { visible: true, timeout: NAV_TIMEOUT_MS });
  await new Promise((r) => setTimeout(r, 2000)); // 等 hydration / 新会话就绪

  const beforeText = await bodyText(page);

  // 2. 发送一条简短真实消息
  await page.type('textarea[name="message"]', MESSAGE, { delay: 12 });
  await page.keyboard.press("Enter");

  // 3. 确认用户消息已上屏（发送成功）
  const sendDeadline = Date.now() + 30_000;
  let afterSendText = "";
  for (;;) {
    const current = await bodyText(page);
    if (current.includes(MESSAGE)) {
      afterSendText = current;
      break;
    }
    if (Date.now() > sendDeadline) {
      fail(`发送后 ${30_000}ms 内页面未出现用户消息`, { bodyTail: current.slice(-300) });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 4. 等待 assistant 回复（120s 超时）。双重信号：
  //    - 网络信号（权威）：POST /api/chat-sessions 已携带 role=assistant（turn 结束才全量同步）；
  //    - UI 信号：body 文本比发送后增长（排除 >4 字符噪音时仍以网络信号为准）。
  const reply = await pollForTextGrowth(page, afterSendText, SEND_TEXT_TIMEOUT_MS);
  if (!reply.ok) {
    fail(`等待 assistant 回复超时（${SEND_TEXT_TIMEOUT_MS}ms 内 body 文本未比发送后增长）`, {
      bodyTail: reply.text.slice(-500),
    });
  }
  const syncDeadline = Date.now() + 30_000;
  while (!summary.assistantSynced && Date.now() < syncDeadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!summary.assistantSynced) {
    fail("回复已上屏但未随 POST /api/chat-sessions 落库（assistant 消息缺失）", {
      bodyTail: reply.text.slice(-500),
      syncedRoles: summary.syncedRoles,
    });
  }

  // 5. 会话持久化断言：URL 自动切到 /chat/<sessionId>
  const pathDeadline = Date.now() + 60_000;
  let sessionId = null;
  let pathAfterSend = null;
  for (;;) {
    pathAfterSend = await page.evaluate(() => window.location.pathname);
    const m = /^\/chat\/([^/]+)$/.exec(pathAfterSend);
    if (m && m[1] !== "new") {
      sessionId = decodeURIComponent(m[1]);
      break;
    }
    if (Date.now() > pathDeadline) {
      fail(`等待 URL 切到 /chat/<sessionId> 超时`, { pathAfterSend, bodyTail: (await bodyText(page)).slice(-300) });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  summary.pathAfterSend = pathAfterSend;
  summary.sessionId = sessionId;

  // 6. GET /api/chat-sessions 应包含该 sessionId（title 非空）
  let sessions = [];
  try {
    const res = await fetch(`${BASE}/api/chat-sessions`);
    const data = await res.json().catch(() => ({}));
    sessions = Array.isArray(data.sessions) ? data.sessions : [];
    summary.historyListed = res.ok && Array.isArray(data.sessions);
    const hit = sessions.find((s) => s.sessionId === sessionId);
    summary.historyContainsSession = Boolean(hit);
    if (hit) summary.title = typeof hit.title === "string" ? hit.title : null;
    summary.historyFields = sessions.length
      ? {
          sample: sessions[0],
          hasSessionId: sessions.every((s) => "sessionId" in s),
          hasTitle: sessions.every((s) => "title" in s),
          hasStreamIndex: sessions.every((s) => "streamIndex" in s),
        }
      : null;
    if (!summary.historyContainsSession || !hit?.title) {
      fail("历史清单未包含测试会话或 title 为空", {
        sessionId,
        historyContainsSession: summary.historyContainsSession,
        title: hit?.title ?? null,
        sessionCount: sessions.length,
      });
    }
  } catch (e) {
    fail("GET /api/chat-sessions 失败", { error: String(e) });
  }

  // 7. page.goto /chat/<sessionId>，断言用户消息与 assistant 回复均重新出现（完整会话恢复链路）
  await page.goto(`${BASE}/chat/${encodeURIComponent(sessionId)}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector('textarea[name="message"]', { visible: true, timeout: NAV_TIMEOUT_MS });
  // assistant 回复短则取全文，长则取前 30 字符作为恢复断言锚点（innerText 可能折叠换行）。
  const assistantAnchor = summary.assistantReply ? summary.assistantReply.slice(0, 30) : null;
  const restoreDeadline = Date.now() + RESTORE_TIMEOUT_MS;
  for (;;) {
    const current = await bodyText(page);
    const userRestored = current.includes(MESSAGE);
    const assistantRestored = !assistantAnchor || current.includes(assistantAnchor);
    if (userRestored && assistantRestored) {
      summary.restoreVerified = true;
      break;
    }
    if (Date.now() > restoreDeadline) {
      fail(`恢复会话页面未完整重现消息`, {
        sessionId,
        userRestored,
        assistantRestored,
        assistantAnchor,
        bodyTail: current.slice(-500),
      });
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // 8. 清理：DELETE /api/chat-sessions?sessionId=<id>
  summary.cleanupAttempted = true;
  try {
    const del = await fetch(`${BASE}/api/chat-sessions?sessionId=${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    summary.cleanupOk = del.ok;
  } catch (e) {
    summary.cleanupOk = false;
    summary.cleanupError = String(e);
  }

  if (summary.pageErrors.length > 0) {
    fail("存在未过滤的 pageerror", { pageErrors: summary.pageErrors });
  }
  if (summary.consoleErrors.length > 0) {
    fail("存在未过滤的 console error", { consoleErrors: summary.consoleErrors });
  }

  pass();
} catch (e) {
  fail("脚本执行异常", { error: e instanceof Error ? e.stack : String(e) });
} finally {
  if (browser) await browser.close().catch(() => {});
}
