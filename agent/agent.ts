import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

// AI SDK DevTools 已禁用（用户要求）：原注册块会捕获每次 streamText 调用到
// localhost:4983 viewer，且注册本身在开发环境偶发干扰。如需恢复，在开发
// 环境注册 DevToolsTelemetry 即可（生产环境不应注册）。

const baseURL = process.env.OPENCODE_GO_BASE_URL?.trim() || "https://opencode.ai/zen/go/v1";
const modelId = process.env.OPENCODE_GO_MODEL?.trim() || "deepseek-v4-flash";
const primaryApiKey = process.env.OPENCODE_GO_API_KEY?.trim();
const fallbackApiKey = process.env.OPENCODE_GO_FALLBACK_API_KEY?.trim();

if (!primaryApiKey && !fallbackApiKey) {
  throw new Error(
    "Set OPENCODE_GO_API_KEY or OPENCODE_GO_FALLBACK_API_KEY before starting the agent.",
  );
}

const retryableStatuses = new Set([401, 403, 408, 409, 425, 429]);

const fetchWithKeyFallback: typeof fetch = async (input, init) => {
  // body 流只能消费一次：主 key 429（用量配额耗尽）时 fallback 必须用 tee 出的
  // 另一半重发，否则抛「Response body object should not be disturbed or locked」。
  // Request 实例的 clone() 也共享同一底层流，同样不能安全重发——统一从原始
  // body 流 tee 一次（非流 body（string/buffer）可安全重复使用）。
  const originalBody = input instanceof Request ? input.body : init?.body;
  const bodyStream = originalBody instanceof ReadableStream ? originalBody.tee() : null;

  const request = async (apiKey: string, body?: BodyInit | null) => {
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    headers.set("authorization", `Bearer ${apiKey}`);
    if (input instanceof Request) return fetch(new Request(input, { body, headers }));
    return fetch(input, { ...init, body, headers });
  };

  const primaryKey = primaryApiKey ?? fallbackApiKey;
  if (!primaryKey) throw new Error("No OpenCode Go API key is configured.");

  try {
    const response = await request(primaryKey, bodyStream ? bodyStream[0] : originalBody ?? null);
    const shouldFallback =
      Boolean(primaryApiKey && fallbackApiKey) &&
      (retryableStatuses.has(response.status) || response.status >= 500);

    if (!shouldFallback) return response;

    await response.body?.cancel();
    return request(fallbackApiKey!, bodyStream ? bodyStream[1] : originalBody ?? null);
  } catch (error) {
    if (!primaryApiKey || !fallbackApiKey) throw error;
    return request(fallbackApiKey, bodyStream ? bodyStream[1] : originalBody ?? null);
  }
};

const opencodeGo = createOpenAICompatible({
  name: "opencode-go",
  baseURL,
  fetch: fetchWithKeyFallback,
  includeUsage: true,
});

export default defineAgent({
  model: opencodeGo(modelId),
  modelContextWindowTokens: 1_000_000,
  // fsevents 是原生二进制模块（playwright 依赖链），bundling 会失败；
  // 保持 external，让 Nitro 按运行时依赖追踪（AgentBay SDK 引入后触发）
  build: { externalDependencies: ["fsevents", "playwright-core", "wuying-agentbay-sdk", "@alicloud/openapi-core", "@darabonba/typescript"] },
});
