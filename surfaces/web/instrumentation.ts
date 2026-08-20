/**
 * AI SDK DevTools 注册（仅本地开发）：
 * 捕获所有 AI SDK 调用（streamText / generateText / ToolLoopAgent）到
 * localhost:4983 的 viewer，用于调试模型请求/响应/推理流/工具调用/token 用量。
 * 生产环境不注册（DevTools 官方声明仅限本地开发）。
 */
export async function register() {
  if (process.env.NODE_ENV === "development" && process.env.NEXT_RUNTIME === "nodejs") {
    const { registerTelemetry } = await import("ai");
    const { DevToolsTelemetry } = await import("@ai-sdk/devtools");
    registerTelemetry(DevToolsTelemetry());
    console.log("[devtools] DevToolsTelemetry 已注册");
  } else {
    console.log(`[devtools] 跳过注册 NODE_ENV=${process.env.NODE_ENV} RUNTIME=${process.env.NEXT_RUNTIME}`);
  }
}
