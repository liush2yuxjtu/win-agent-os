/**
 * 技能评估统一入口：跑 trigger + functional 两类评估，返回结构化结果 + 两份 HTML。
 * 供 agent 工具（run_skill_evals）与 /evals 页面共用。
 */
import { loadSkill } from "./load";
import { runTriggerEval, loadTriggerCases } from "./trigger";
import { runFunctionalEval, loadFunctionalCases } from "./functional";
import { renderTriggerHtml, renderFunctionalHtml } from "./html";
import type { EvalExecutionResult, SkillEvalRun } from "./types";

export interface SkillEvalOutput {
  run: SkillEvalRun;
  triggerHtml: string;
  functionalHtml: string;
  /** 供聊天内联展示的简短摘要（markdown）。 */
  summary: string;
}

/** runSkillEvals 可选参数：functional 评估可注入外部执行结果（eval-runner 子代理产出），注入后跳过内部 LLM 模拟判定。 */
export interface RunSkillEvalsOptions {
  /** 外部执行结果数组（每条对应一个 functional 用例，按 input 匹配）。传入时跳过内部 LLM 模拟执行与评判；不传时行为不变。 */
  executionResults?: EvalExecutionResult[];
}

/** 无技能基线：用占位描述跑同一组 trigger 用例，测「没有该技能」时的自然触发率。 */
const BASELINE_SKILL_NAME = "通用助手";
const BASELINE_DESCRIPTION = "你是一个通用业务助手，回答用户问题。";

export async function runSkillEvals(skillName: string, opts?: RunSkillEvalsOptions): Promise<SkillEvalOutput> {
  const skill = loadSkill(skillName);
  const triggerCases = loadTriggerCases(skill.evals);
  const injected = (opts?.executionResults?.length ?? 0) > 0;

  // 基线评估与正常评估并行：同一组用例，仅 description 换成占位描述（技能自身描述即基线时跳过）。
  const baselineRun =
    skill.description !== BASELINE_DESCRIPTION
      ? runTriggerEval(BASELINE_SKILL_NAME, BASELINE_DESCRIPTION, triggerCases)
      : null;
  const [trigger, functional, baselineResult] = await Promise.all([
    runTriggerEval(skill.name, skill.description, triggerCases),
    runFunctionalEval(skill.name, skill.body, loadFunctionalCases(skill.evals), undefined, opts?.executionResults),
    baselineRun,
  ]);

  const run: SkillEvalRun = {
    skillName: skill.name,
    skillDescription: skill.description,
    triggeredAt: new Date().toISOString(),
    trigger,
    functional,
    ...(baselineResult ? { baseline: { triggerAccuracy: baselineResult.accuracy } } : {}),
  };

  const triggerAcc = Math.round(trigger.accuracy * 100);
  const funcRate = Math.round(functional.passRate * 100);
  const summary = [
    `## ${skill.name} 技能评估`,
    ``,
    `**触发准确性（Trigger）**：${triggerAcc}% 命中（${trigger.passed}/${trigger.total} 例）— 误触发 ${trigger.falsePositives}，漏触发 ${trigger.falseNegatives}`,
    `**功能正确性（Functional）**：${funcRate}% 通过（${functional.passed} 通过 / ${functional.partial} 部分 / ${functional.failed} 失败）${injected ? "（判定采用外部执行结果注入，跳过内部模拟）" : ""}`,
    ``,
    `两份完整报告已生成（HTML 附件）。`,
  ].join("\n");

  return { run, triggerHtml: renderTriggerHtml(run), functionalHtml: renderFunctionalHtml(run), summary };
}
