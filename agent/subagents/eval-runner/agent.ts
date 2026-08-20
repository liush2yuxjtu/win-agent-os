/**
 * eval-runner 声明式子代理：真实执行一个技能功能评估用例。
 *
 * 父 agent（model 编排）通过内置 agent 工具（可并行）派发本子代理，
 * 消息内携带：SKILL.md 内容（或路径）+ 用例 prompt + 期望要点。
 * defineAgent 级 outputSchema 使每次派发都进入 task mode，返回结构化
 * EvalExecutionResult（与 agent/lib/skill-evals/types.ts 的 EvalExecutionResult
 * 对齐：caseId/input/verdict/evidence/output），run_skill_evals 汇总时直接注入。
 *
 * 模型与根 agent 同源（OpenCode Go / OpenAI-compatible，无 Vercel AI Gateway
 * 配置，故不能使用 gateway id 字符串）。apiKey 缺失时不抛错（构建/类型检查
 * 阶段可能无环境变量），真正被派发时才在请求层失败，与 llm.ts 的惰性模式一致。
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

const baseURL = process.env.OPENCODE_GO_BASE_URL?.trim() || "https://opencode.ai/zen/go/v1";
const modelId = process.env.OPENCODE_GO_MODEL?.trim() || "deepseek-v4-flash";
const apiKey = process.env.OPENCODE_GO_API_KEY?.trim() || process.env.OPENCODE_GO_FALLBACK_API_KEY?.trim();

const opencodeGo = createOpenAICompatible({
  name: "opencode-go-eval-runner",
  baseURL,
  apiKey,
});

export default defineAgent({
  description:
    "执行一个技能功能评估用例：接收技能 SKILL.md 指令（内容或路径）与一条用例任务输入，按指令真实执行该任务，返回结构化判定结果（verdict: pass/partial/fail + evidence 证据 + output 执行输出全文）。批量评估时父 agent 应并行派发多个本子代理实例，每个实例只处理一个用例。",
  model: opencodeGo(modelId),
  modelContextWindowTokens: 1_000_000,
  limits: {
    // 单用例执行是一次性任务：15 分钟上限兜底，避免默认 30 天会话时长挂在失败请求上
    sessionTimeoutMs: 15 * 60_000,
  },
  // task mode 结构化返回：与 agent/lib/skill-evals/types.ts 的 EvalExecutionResult 一致
  outputSchema: {
    type: "object",
    properties: {
      caseId: { type: "string" },
      input: { type: "string" },
      verdict: { type: "string", enum: ["pass", "partial", "fail"] },
      evidence: { type: "string" },
      output: { type: "string" },
    },
    required: ["caseId", "input", "verdict", "evidence", "output"],
    additionalProperties: false,
  },
});
