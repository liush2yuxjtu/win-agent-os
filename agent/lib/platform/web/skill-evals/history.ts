/**
 * 评估运行历史：记录每次评估的关键指标，供「迭代对比」（重跑后 diff 展示）。
 * 存储：.eve/artifacts/skill-evals/<skill>-history.json
 */
import fs from "node:fs";
import path from "node:path";
import { getAgentPaths } from "../../../../platform";

export interface EvalRunRecord {
  /** ISO 时间戳。 */
  ranAt: string;
  /** 工作区迭代号（<skill>-workspace/iteration-N/ 的 N，旧记录无此字段）。 */
  iteration?: number;
  triggerAccuracy: number;
  functionalPassRate: number;
  /** 无技能基线触发率（可选——旧记录无此字段）。 */
  baselineTriggerAccuracy?: number;
  /** 逐例 key → 是否通过（trigger 用 prompt、functional 用 input 前 24 字符）。 */
  triggerCases: Record<string, boolean>;
  functionalCases: Record<string, boolean>;
  /** 完整报告路径。 */
  files?: string[];
}

export interface EvalHistory {
  skillName: string;
  runs: EvalRunRecord[];
}

function historyPath(skillName: string): string {
  return path.join(getAgentPaths().skillEvalsDir, `${skillName}-history.json`);
}

export function loadHistory(skillName: string): EvalHistory {
  const file = historyPath(skillName);
  if (!fs.existsSync(file)) return { skillName, runs: [] };
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as EvalHistory;
  } catch {
    return { skillName, runs: [] };
  }
}

/** 追加一次运行记录（保留最近 10 次）。 */
export function appendRun(skillName: string, record: EvalRunRecord): EvalHistory {
  const history = loadHistory(skillName);
  history.runs.push(record);
  if (history.runs.length > 10) history.runs = history.runs.slice(-10);
  fs.mkdirSync(path.dirname(historyPath(skillName)), { recursive: true });
  fs.writeFileSync(historyPath(skillName), JSON.stringify(history, null, 2) + "\n", "utf8");
  return history;
}

/** 上一次运行的记录（无则 null）——用于 diff。 */
export function getLastRun(skillName: string): EvalRunRecord | null {
  const history = loadHistory(skillName);
  return history.runs.length > 0 ? history.runs[history.runs.length - 1] : null;
}

/** 逐例 key：trigger 用提问、functional 用输入前 24 字符。 */
export function caseKey(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 24);
}

/** 生成对比摘要（当前 vs 上一次）：指标变化 + 逐例翻转。 */
export function buildComparison(
  skillName: string,
  current: EvalRunRecord,
): {
  hasPrevious: boolean;
  triggerDelta: number | null;
  functionalDelta: number | null;
  triggerImproved: string[];
  triggerRegressed: string[];
  functionalImproved: string[];
  functionalRegressed: string[];
} | null {
  const previous = getLastRun(skillName);
  if (!previous) return null;

  const triggerImproved: string[] = [];
  const triggerRegressed: string[] = [];
  for (const [key, pass] of Object.entries(current.triggerCases)) {
    const prevPass = previous.triggerCases[key];
    if (prevPass === undefined) continue;
    if (pass && !prevPass) triggerImproved.push(key);
    if (!pass && prevPass) triggerRegressed.push(key);
  }
  const functionalImproved: string[] = [];
  const functionalRegressed: string[] = [];
  for (const [key, pass] of Object.entries(current.functionalCases)) {
    const prevPass = previous.functionalCases[key];
    if (prevPass === undefined) continue;
    if (pass && !prevPass) functionalImproved.push(key);
    if (!pass && prevPass) functionalRegressed.push(key);
  }

  return {
    hasPrevious: true,
    triggerDelta: current.triggerAccuracy - previous.triggerAccuracy,
    functionalDelta: current.functionalPassRate - previous.functionalPassRate,
    triggerImproved,
    triggerRegressed,
    functionalImproved,
    functionalRegressed,
  };
}
