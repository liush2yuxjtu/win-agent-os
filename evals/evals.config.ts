import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({
  // 单用例超时放宽：run_skill_evals 会真实跑评估（多次 LLM 调用）
  timeoutMs: 900_000,
});
