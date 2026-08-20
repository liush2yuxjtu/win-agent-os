import fs from "node:fs";
import path from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getAgentPaths } from "../platform";
import { loadHistory, type EvalRunRecord } from "../lib/platform/web/skill-evals/history";

/**
 * 评估趋势聚合工具：读取历次评估记录（run_skill_evals 每次运行 append 到
 * .eve/artifacts/skill-evals/<skill>-history.json），输出演进轨迹与趋势判断。
 * 历史文件不存在/损坏时按无记录处理（runs 为空数组），不报错。
 */

interface RunSummary {
  ranAt: string;
  triggerAccuracy: number;
  functionalPassRate: number;
  files?: string[];
}

interface SkillTrend {
  skillName: string;
  runs: RunSummary[];
  latest: RunSummary | null;
  /** 最佳成绩：triggerAccuracy 最高的一次（并列取最早）。 */
  best: RunSummary | null;
  /** single=仅 1 次运行；improving/declining/flat=较上一次（≥2 次）。 */
  trend: "improving" | "declining" | "flat" | "single";
  /** 最新 vs 上一次的 triggerAccuracy 差（百分点）；<2 次为 null。 */
  deltaPp: number | null;
  /** 文本化演进：如「8月18日 77.8% → 8月18日 88.9%（+11.1pp）」。 */
  narrative: string;
}

/** 与上次相差 ≥1 个百分点才算提升/下降。 */
const TREND_THRESHOLD_PP = 1;

function historyDir(): string {
  return getAgentPaths().skillEvalsDir;
}

/** 枚举全部技能名：有历史文件的 + skill-packages 下含 SKILL.md 的技能包。 */
function listAllSkills(): string[] {
  const names = new Set<string>();
  try {
    for (const entry of fs.readdirSync(historyDir())) {
      const m = entry.match(/^(.+)-history\.json$/);
      if (m) names.add(m[1]);
    }
  } catch {
    // 历史目录不存在 → 只剩 skills 目录里的技能
  }
  const skillsRoot = getAgentPaths().skillsRoot;
  try {
    for (const entry of fs.readdirSync(skillsRoot)) {
      if (entry.startsWith(".")) continue;
      const p = path.join(skillsRoot, entry);
      if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "SKILL.md"))) {
        names.add(entry);
      }
    }
  } catch {
    // skills 目录不存在 → 只剩有历史文件的技能
  }
  return [...names].sort();
}

function toRunSummary(r: EvalRunRecord): RunSummary {
  return {
    ranAt: r.ranAt,
    triggerAccuracy: r.triggerAccuracy,
    functionalPassRate: r.functionalPassRate,
    files: r.files,
  };
}

/** M月D日（本地时区）。 */
function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 0.889 → "88.9%"；整数去掉小数尾。 */
function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

function buildNarrative(runs: RunSummary[]): string {
  if (runs.length === 0) return "暂无评估记录";
  let out = `${fmtDay(runs[0].ranAt)} ${fmtPct(runs[0].triggerAccuracy)}`;
  for (let i = 1; i < runs.length; i++) {
    const deltaPp = (runs[i].triggerAccuracy - runs[i - 1].triggerAccuracy) * 100;
    if (Math.abs(deltaPp) < TREND_THRESHOLD_PP) {
      out += ` → ${fmtDay(runs[i].ranAt)} ${fmtPct(runs[i].triggerAccuracy)}（持平）`;
    } else {
      out += ` → ${fmtDay(runs[i].ranAt)} ${fmtPct(runs[i].triggerAccuracy)}（${deltaPp >= 0 ? "+" : ""}${deltaPp.toFixed(1)}pp）`;
    }
  }
  return out;
}

function buildSkillTrend(skillName: string): SkillTrend {
  const runs = loadHistory(skillName).runs.map(toRunSummary);
  const latest = runs.length > 0 ? runs[runs.length - 1] : null;
  let best: RunSummary | null = null;
  for (const r of runs) {
    if (!best || r.triggerAccuracy > best.triggerAccuracy) best = r;
  }
  let trend: SkillTrend["trend"] = "flat";
  let deltaPp: number | null = null;
  if (runs.length === 1) {
    trend = "single";
  } else if (runs.length >= 2) {
    const last = runs[runs.length - 1];
    const prev = runs[runs.length - 2];
    deltaPp = (last.triggerAccuracy - prev.triggerAccuracy) * 100;
    if (deltaPp > TREND_THRESHOLD_PP) trend = "improving";
    else if (deltaPp < -TREND_THRESHOLD_PP) trend = "declining";
    else trend = "flat";
  }
  return { skillName, runs, latest, best, trend, deltaPp, narrative: buildNarrative(runs) };
}

export default defineTool({
  description:
    "查看技能的历次评估趋势：读取每次评估的 triggerAccuracy（触发准确率）与 functionalPassRate（功能通过率），输出演进轨迹、较上次的变化（百分点 delta）、最佳成绩与趋势判断（提升/下降/持平）。不传 skillName 时返回全部技能的评估趋势；无历史记录的技能 runs 为空数组。",
  inputSchema: z.object({
    skillName: z
      .string()
      .optional()
      .describe("技能名（skill-packages/ 下的目录名，如 ai-control）；缺省返回全部技能"),
  }),
  async execute({ skillName }) {
    try {
      const names = skillName ? [skillName] : listAllSkills();
      return { ok: true, skills: names.map(buildSkillTrend) };
    } catch (error) {
      return {
        ok: false,
        skills: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
