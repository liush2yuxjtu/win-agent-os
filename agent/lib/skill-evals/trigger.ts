/**
 * Trigger eval：评估技能 description 的路由准确性。
 *
 * 对每个用例（用户提问），模型按「description + 触发规则」判断该提问
 * 应否触发此技能，与期望对比 → 命中率/误触发/漏触发 + 逐例依据。
 * 这是「提高触发」的评估——description 写得好不好直接影响 agent 何时加载技能。
 */
import { askEvalModelJson } from "./llm";
import type { SkillEvalRun, TriggerCaseResult, TriggerEvalCase } from "./types";

/** 内置默认用例（技能未声明 evals.json 时兜底）：覆盖正例与易混淆负例。 */
export const DEFAULT_TRIGGER_CASES: TriggerEvalCase[] = [
  { prompt: "帮我看看这个素材该不该追投", expectedTrigger: true, note: "追投类意图正例" },
  { prompt: "盘点一下达到追投门槛的素材", expectedTrigger: true, note: "候选盘点正例" },
  { prompt: "今天天气怎么样", expectedTrigger: false, note: "无关问题负例" },
  { prompt: "帮我写一封请假邮件", expectedTrigger: false, note: "办公场景负例" },
];

const JUDGE_SYSTEM = `你是技能路由评估器。给定一个技能的 description（模型据此决定何时加载该技能），
对每条用户提问判断：该技能【应否】被触发（加载）。
只输出 JSON：{"trigger": true|false, "reason": "一句简短中文依据"}。
判定标准：提问是否落在 description 描述的触发场景内；语义相近、同域变体也算应触发；
泛泛无关问题（天气/闲聊/其他办公任务）不算。`;

interface JudgeResult {
  trigger: boolean;
  reason: string;
}

/** 跑 trigger eval（并发限制 4）。 */
export async function runTriggerEval(
  skillName: string,
  skillDescription: string,
  cases: TriggerEvalCase[],
): Promise<SkillEvalRun["trigger"]> {
  const results: TriggerCaseResult[] = [];
  const concurrency = 4;
  for (let i = 0; i < cases.length; i += concurrency) {
    const batch = cases.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (c) => {
        try {
          const judged = await askEvalModelJson<JudgeResult>(
            JUDGE_SYSTEM,
            `技能名：${skillName}\n技能 description：\n${skillDescription}\n\n用户提问：${c.prompt}\n\n该技能应否被触发？`,
            500,
          );
          return {
            prompt: c.prompt,
            expectedTrigger: c.expectedTrigger,
            predictedTrigger: Boolean(judged.trigger),
            reason: judged.reason ?? "",
            pass: judged.trigger === c.expectedTrigger,
          } satisfies TriggerCaseResult;
        } catch (error) {
          return {
            prompt: c.prompt,
            expectedTrigger: c.expectedTrigger,
            predictedTrigger: false,
            reason: `判定失败：${error instanceof Error ? error.message : String(error)}`,
            pass: false,
          } satisfies TriggerCaseResult;
        }
      }),
    );
    results.push(...batchResults);
  }

  const passed = results.filter((r) => r.pass).length;
  const falsePositives = results.filter((r) => !r.expectedTrigger && r.predictedTrigger).length;
  const falseNegatives = results.filter((r) => r.expectedTrigger && !r.predictedTrigger).length;
  return {
    total: results.length,
    passed,
    accuracy: results.length > 0 ? passed / results.length : 0,
    falsePositives,
    falseNegatives,
    cases: results,
  };
}

/** 从技能包读取 trigger 用例（evals.json），缺省用内置默认。 */
export function loadTriggerCases(evalsJson?: { trigger?: TriggerEvalCase[] }): TriggerEvalCase[] {
  const cases = evalsJson?.trigger;
  return cases && cases.length > 0 ? cases : DEFAULT_TRIGGER_CASES;
}
