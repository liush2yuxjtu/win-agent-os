/**
 * 技能评审落盘工具：把专家对评估结果的评审意见写入技能包 evals/feedback.json。
 *
 * 配合 run_skill_evals + ask_question 的 HITL 评审流程：评估完成后 agent 调用
 * ask_question 暂停等待用户评审；用户在前端评审卡片上标注并提交（或直接在对话中
 * 回复意见）；agent 收到意见后调用本工具把结构化评审落盘。后续「按反馈自动改进」
 * 循环经 lib/skill-evals/feedback.ts 的 feedbackSummary 读取（反馈闭环）。
 *
 * key 格式与前端评审卡片完全一致（共用 lib/skill-evals/keys.ts）：
 *   trigger:     → trigger:<prompt 折叠空白后前 24 字符>
 *   functional:  → functional:<input 折叠空白后前 24 字符>
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { saveFeedback } from "../lib/platform/web/skill-evals/feedback";
import { functionalFeedbackKey, triggerFeedbackKey } from "../lib/skill-evals/keys";

/** 技能名校验（与 lib/skill-evals/actions.ts 一致），防路径注入。 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

const VERDICT_LABEL = { pass: "通过", partial: "部分达标", fail: "失败" } as const;

export default defineTool({
  description:
    "把专家对技能评估的评审意见写入技能包 evals/feedback.json（反馈闭环：后续「按反馈自动改进」和迭代改进会读取）。在 run_skill_evals 评估完成、用户通过评审卡片提交或直接在对话中给出评审意见后调用：把意见整理成结构化字段——trigger 纠正（prompt + 应/不应触发 + 备注）与 functional 评价（input + 通过/部分/失败 + 备注）。prompt/input 必须与 run_skill_evals 返回的 triggerCases[].prompt / functionalCases[].input 原文一致（key 由原文前 24 字符生成）。",
  inputSchema: z.object({
    skillName: z.string().describe("技能名（skill-packages/ 下的目录名，如 ai-control）"),
    triggerCorrections: z
      .array(
        z.object({
          prompt: z.string().describe("被评审的 Trigger 用例提问原文（与 run_skill_evals 返回的 triggerCases[].prompt 一致）"),
          shouldTrigger: z.boolean().describe("专家判定该 prompt 应触发（true）还是不应触发（false）本技能"),
          note: z.string().optional().describe("备注（可选）：如 description 缺什么关键词、与哪个技能混淆"),
        }),
      )
      .optional()
      .describe("Trigger 触发纠正：用户对每个 Trigger 例的「应/不应触发」标注，可加备注"),
    functionalReviews: z
      .array(
        z.object({
          input: z.string().describe("被评审的 Functional 用例输入原文（与 run_skill_evals 返回的 functionalCases[].input 一致）"),
          verdict: z.enum(["pass", "partial", "fail"]).describe("专家功能评价：通过 / 部分达标 / 失败"),
          note: z.string().optional().describe("备注（可选）：指令缺什么、口径问题、输出哪里不达标"),
        }),
      )
      .optional()
      .describe("Functional 功能评价：用户对每个 Functional 例的「通过/部分达标/失败」评价，可加备注"),
  }),
  async execute({ skillName, triggerCorrections = [], functionalReviews = [] }) {
    if (!NAME_PATTERN.test(skillName)) {
      return { ok: false, skillName, error: "非法技能名（仅允许小写字母/数字/连字符）" };
    }

    const savedKeys: string[] = [];
    for (const c of triggerCorrections) {
      const note = c.note?.trim();
      const key = triggerFeedbackKey(c.prompt);
      saveFeedback(skillName, key, `${c.shouldTrigger ? "应触发" : "不应触发"}${note ? `；${note}` : ""}`);
      savedKeys.push(key);
    }
    for (const f of functionalReviews) {
      const note = f.note?.trim();
      const key = functionalFeedbackKey(f.input);
      saveFeedback(skillName, key, `${VERDICT_LABEL[f.verdict]}${note ? `；${note}` : ""}`);
      savedKeys.push(key);
    }

    return {
      ok: true,
      skillName,
      savedCount: savedKeys.length,
      feedbackPath: `skill-packages/${skillName}/evals/feedback.json`,
      keys: savedKeys,
    };
  },
});
