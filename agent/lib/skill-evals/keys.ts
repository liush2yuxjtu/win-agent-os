/**
 * 评审反馈 key 约定（唯一来源）：落盘到技能包 evals/feedback.json 的键格式。
 * lib/skill-evals/feedback.ts 只负责存储，key 的语义由这里统一定义——
 * 前端评审卡片（app/_components/eval-inline-review.tsx）与 agent 落盘工具
 * （agent/tools/submit_skill_review.ts）必须共用本模块，保证同一用例的
 * 反馈写进同一个 key，避免两份实现漂移。
 */

/** Trigger 例反馈 key：trigger: + prompt 折叠空白后前 24 字符。 */
export function triggerFeedbackKey(prompt: string): string {
  return `trigger:${prompt.replace(/\s+/g, " ").slice(0, 24)}`;
}

/** Functional 例反馈 key：functional: + input 折叠空白后前 24 字符。 */
export function functionalFeedbackKey(input: string): string {
  return `functional:${input.replace(/\s+/g, " ").slice(0, 24)}`;
}
