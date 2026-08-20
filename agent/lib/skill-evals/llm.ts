/**
 * 评估用 LLM 调用层：复用 opencode-go 模型（与 agent 同源），server 端直调。
 * 仅用于评估判断（触发判定/功能评判），不参与业务查询。
 *
 * 注意：deepseek-v4-flash 是思考型模型 —— reasoning 会吃掉大量输出 token，
 * maxOutputTokens 不足时正文在输出前就被截断（finishReason=length，text 为空）。
 * 因此：空输出自动加大上限重试，仍空则用 reasoning 文本兜底（评审材料不丢）。
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

const baseURL = process.env.OPENCODE_GO_BASE_URL?.trim() || "https://opencode.ai/zen/go/v1";
const modelId = process.env.OPENCODE_GO_MODEL?.trim() || "deepseek-v4-flash";
const apiKey = process.env.OPENCODE_GO_API_KEY?.trim() || process.env.OPENCODE_GO_FALLBACK_API_KEY?.trim();

let provider: ReturnType<typeof createOpenAICompatible> | null = null;

function getProvider() {
  if (!provider) {
    provider = createOpenAICompatible({ name: "opencode-go-eval", baseURL, apiKey });
  }
  return provider;
}

/** 提取 reasoning 文本（ai-sdk v5 的 reasoning 为数组，取全部 text 拼接）。 */
function reasoningText(res: { reasoning?: unknown }): string {
  if (!Array.isArray(res.reasoning)) return "";
  return res.reasoning
    .map((r) => (typeof r === "object" && r !== null && typeof (r as { text?: unknown }).text === "string" ? (r as { text: string }).text : ""))
    .join("");
}

/** 思考型模型兜底：text 空 → 加大上限重试（最多 3 次），仍空用 reasoning。 */
export async function askEvalModel(system: string, prompt: string, maxTokens = 800): Promise<string> {
  if (!apiKey) throw new Error("未配置 OPENCODE_GO_API_KEY，无法运行评估");
  let budget = Math.max(maxTokens, 2000);
  let reasoning = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await generateText({
      model: getProvider()(modelId),
      system,
      prompt,
      temperature: 0.1,
      maxOutputTokens: budget,
      // 每次调用 10 分钟超时：无超时会导致单次挂起时工具永远"执行中"（实测代理/网关慢
      // 或 keep-alive 死连接时会卡死整个评估流程）。超时按重试处理，不中断流程。
      abortSignal: AbortSignal.timeout(10 * 60_000),
    });
    reasoning = reasoningText(res) || reasoning;
    const content = (res.text ?? "").trim();
    if (content.length > 0) return content;
    // 正文被思考截断 → 下次给足额度（思考+正文），让模型有机会输出完整回答
    budget = Math.max(budget, 4000);
  }
  // 全部重试正文仍空：退回 reasoning（评审至少能看到思考过程，而非空白）
  return reasoning.trim();
}

/** 要求模型输出 JSON 并解析（容错：剥离代码围栏；先整体解析，再退化为提取对象）。 */
export async function askEvalModelJson<T>(system: string, prompt: string, maxTokens = 1200): Promise<T> {
  const raw = await askEvalModel(system, prompt, maxTokens);
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  // 1) 整体解析（模型按要求只输出 JSON 时）
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 2) 退化：提取第一个 { 到最后一个 }（可能前后有说明文字）
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error(`模型未返回 JSON：${raw.slice(0, 160)}`);
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  }
}
