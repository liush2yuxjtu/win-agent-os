/**
 * 评审反馈持久化：专家在评审工作流里写的反馈存到技能包 evals/feedback.json，
 * agent 后续改进技能时可读取（反馈闭环）。
 */
import fs from "node:fs";
import path from "node:path";
import { getAgentPaths } from "../../../../platform";

export type FeedbackMap = Record<string, string>;

function feedbackPath(skillName: string): string {
  return path.join(getAgentPaths().skillsRoot, skillName, "evals", "feedback.json");
}

/** 保存一条反馈（key = evalId 或 run 标识）。 */
export function saveFeedback(skillName: string, key: string, text: string): void {
  const file = feedbackPath(skillName);
  let all: FeedbackMap = {};
  if (fs.existsSync(file)) {
    try {
      all = JSON.parse(fs.readFileSync(file, "utf8")) as FeedbackMap;
    } catch {
      all = {};
    }
  }
  if (text.trim()) {
    all[key] = text.trim();
  } else {
    delete all[key];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n", "utf8");
}

/** 读取全部反馈（供 UI 回显与 agent 改进）。 */
export function loadFeedback(skillName: string): FeedbackMap {
  const file = feedbackPath(skillName);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as FeedbackMap;
  } catch {
    return {};
  }
}

/** 反馈汇总文本（agent 改进时读取的形态）。 */
export function feedbackSummary(skillName: string): string {
  const all = loadFeedback(skillName);
  const entries = Object.entries(all);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `- ${k}: ${v}`).join("\n");
}
