"use server";

import { Client } from "eve/client";
import { loadFeedback, saveFeedback, feedbackSummary, type FeedbackMap } from "@agent/lib/platform/web/skill-evals/feedback";
import type { BenchmarkSummary, SkillEvalRun } from "@agent/lib/skill-evals/types";
import { runBenchmark } from "@agent/lib/skill-evals/benchmark";
import { runTriggerEval, loadTriggerCases } from "@agent/lib/skill-evals/trigger";
import { loadSkill } from "@agent/lib/skill-evals/load";

const eveHost = process.env.EVE_INTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const eveClient = new Client({ host: eveHost });

/**
 * 运行一次对照评估（with/without skill、new/old skill），返回统计摘要 + 该技能的既有评审反馈。
 * 供 /evals 页面的「运行评估」按钮调用。
 */
export async function runEvalBenchmark(
  skillName: string,
): Promise<{ ok: true; summary: BenchmarkSummary; feedback: FeedbackMap } | { ok: false; error: string }> {
  const name = skillName.trim();
  if (!name) return { ok: false, error: "请先选择一个技能" };
  try {
    const summary = await runBenchmark(name);
    return { ok: true, summary, feedback: loadFeedback(name) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 运行 Trigger 评估（description 路由命中测试），返回逐例判定 + 该技能既有反馈。
 * 供 /evals 页面的 Trigger 评审区调用。
 */
export async function runTriggerEvals(
  skillName: string,
): Promise<{ ok: true; run: SkillEvalRun["trigger"]; skillDescription: string; feedback: FeedbackMap } | { ok: false; error: string }> {
  const name = skillName.trim();
  if (!name) return { ok: false, error: "请先选择一个技能" };
  try {
    const skill = loadSkill(name);
    const trigger = await runTriggerEval(skill.name, skill.description, loadTriggerCases(skill.evals));
    return { ok: true, run: trigger, skillDescription: skill.description, feedback: loadFeedback(name) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 自动改进循环：读取该技能的评审反馈，起一个 eve 会话让 agent 按反馈改进
 * SKILL.md 并重跑评估（run_skill_evals）。改进会话在后台运行，结果记录在
 * 运行历史（history.json）——下次评估时展示与本次的对比。
 * 返回会话 id，供前端提示。
 */
export async function triggerSkillImprovement(
  skillName: string,
): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  if (!NAME_PATTERN.test(skillName)) return { ok: false, error: "非法技能名" };
  const feedback = feedbackSummary(skillName);
  if (!feedback) return { ok: false, error: "该技能还没有评审反馈——先在评审卡片里给出意见，再自动改进" };

  const message = [
    `请根据评审反馈改进技能「${skillName}」并重新评估。`,
    ``,
    `评审反馈（skill-packages/${skillName}/evals/feedback.json）：`,
    feedback,
    ``,
    `要求：`,
    `1. 按反馈逐条修改 SKILL.md（description 路由或指令/口径），只做反馈要求的改动，不重写无关内容；`,
    `2. 修改后调用 run_skill_evals 重新评估；`,
    `3. 汇报改动点与新旧指标对比（评估工具会返回 comparison）。`,
  ].join("\n");

  try {
    const { session } = await eveClient.sessions.create({ message });
    return { ok: true, sessionId: session.state.sessionId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// 评审反馈读写（server action 包装，client 组件经此调用 node fs 模块）
// ---------------------------------------------------------------------------

/** 技能名校验（与 lib/skills/actions.ts 一致），防路径注入。 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export type EvalFeedbackResult = { ok: true } | { ok: false; error: string };

/**
 * 保存一条评审反馈（key = evalId）。
 * 写入技能包 evals/feedback.json（见 lib/skill-evals/feedback.ts），
 * agent 后续改进技能时经 feedbackSummary 读取（反馈闭环）。
 */
export async function saveEvalFeedback(skillName: string, key: string, text: string): Promise<EvalFeedbackResult> {
  if (!NAME_PATTERN.test(skillName)) return { ok: false, error: "非法技能名" };
  if (!key.trim()) return { ok: false, error: "反馈 key 为空" };
  try {
    saveFeedback(skillName, key, text);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 读取技能的全部评审反馈（页面 SSR 初始化 initialFeedback 用）。 */
export async function loadEvalFeedback(skillName: string): Promise<FeedbackMap> {
  if (!NAME_PATTERN.test(skillName)) return {};
  return loadFeedback(skillName);
}
