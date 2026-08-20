/**
 * eve 前端独立模式（frontend-only）配置。
 *
 * 默认行为保持不变：`next.config.ts` 用 `withEve()` 把 agent 挂载进
 * Next.js，`npm run dev` 一个进程同时拉起前端和嵌入式 eve。
 *
 * 独立测试模式（agent 原样单独跑，前端作为消费者单独跑）：
 *
 *   # 终端 1：原来的 chatbot eve app，单独运行（默认端口 2000）
 *   npm run dev:eve
 *
 *   # 终端 2：只启动 Web 前端，把 /eve/v1/* 代理到上面的 agent
 *   npm run dev:frontend
 *   # 或指向任意 agent：EVE_AGENT_ORIGIN=http://127.0.0.1:2000
 *
 * 该模式下前端代码仍走同源 `/eve/v1/*`（由 Next.js rewrite 转发），
 * 因此不需要给 `agent/channels/eve.ts` 开 CORS，agent 目录零改动。
 */

/** EVE_FRONTEND_ONLY=1 时跳过 withEve，前端不内嵌/不拉起 agent。 */
export function isEveFrontendOnly(): boolean {
  return process.env.EVE_FRONTEND_ONLY === "1";
}

/**
 * 前端独立模式下要连接的 eve agent origin。
 * 默认 http://127.0.0.1:2000（`eve dev` 的默认端口）。
 * 只接受 http/https origin，path / query 会被拒绝，避免把 rewrite 配成
 * 非预期的 URL。
 */
export function getEveAgentOrigin(): string {
  const raw = process.env.EVE_AGENT_ORIGIN?.trim() || "http://127.0.0.1:2000";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`EVE_AGENT_ORIGIN 不是合法的 URL: ${JSON.stringify(raw)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`EVE_AGENT_ORIGIN 只支持 http/https: ${JSON.stringify(raw)}`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`EVE_AGENT_ORIGIN 必须是纯 origin（不含 path/query/hash）: ${JSON.stringify(raw)}`);
  }
  return parsed.origin;
}
