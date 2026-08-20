/**
 * 技能评估运行数据库（SQLite，node:sqlite 零依赖）。
 *
 * 目的：把每次评估运行的「完整逐例数据」结构化持久化 —— 真实输出、
 * verdict 三态（pass/partial/fail）、判定依据（reason）、期望要点，
 * 以及 iteration-N 工作区编号与报告文件路径。history.json 只存坍缩布尔
 * （partial 与 fail 同视为 false、真实输出不落盘），本库为增量补充数据源，
 * 供前端评审卡摘录、趋势对比与跨会话检索。
 *
 * 与 history.ts 的关系（向后兼容）：
 *  - appendRun/loadHistory/buildComparison 保持不变（eval_trends.ts 与
 *    SkillEvalsStore 接口依赖它们）；
 *  - 本库由 run_skill_evals 在 appendRun 旁增量调用（syncEvalRun），
 *    两者并存，互不替代。
 *
 * 表结构：
 *  - skill_eval_runs：每次运行一行（run_id 主键，upsert 幂等）。
 *    cases_json 存 { trigger: TriggerCaseResult[], functional: FunctionalCaseResult[] }，
 *    files_json 存报告路径数组（对齐 history.EvalRunRecord.files）。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAgentPaths } from "../../../../platform";
import type { FunctionalCaseResult, SkillEvalRun, TriggerCaseResult } from "../../../skill-evals/types";

/** 逐例 JSON 载荷：完整保留真实输出、verdict 三态与判定依据。 */
export interface StoredEvalCases {
  trigger: TriggerCaseResult[];
  functional: FunctionalCaseResult[];
}

/** skill_eval_runs 行（读回映射后的类型）。 */
export interface EvalRunDbRecord {
  /** 运行唯一键（默认 `${skillName}-${triggeredAt}`，重跑自动换新）。 */
  runId: string;
  skillName: string;
  /** iteration-N 工作区编号（无迭代则 null）。 */
  iteration: number | null;
  /** ISO 时间戳，对齐 history.EvalRunRecord.ranAt。 */
  ranAt: string;
  /** 触发命中率 0-1。 */
  triggerAccuracy: number;
  /** 功能通过率（pass/total）0-1。 */
  functionalPassRate: number;
  /** 无技能基线触发率（可选——旧记录无此字段）。 */
  baselineTriggerAccuracy: number | null;
  /** 逐例明细（含真实输出 / verdict 三态 / 依据）。 */
  cases: StoredEvalCases;
  /** 完整报告路径（trigger/functional HTML 等）。 */
  files: string[];
  createdAt: string;
  updatedAt: string;
}

export function skillEvalsDbPath(): string {
  return getAgentPaths().skillEvalsDbPath;
}

export function openSkillEvalsDb(): DatabaseSync {
  const dbPath = getAgentPaths().skillEvalsDbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA busy_timeout = 2000;
    CREATE TABLE IF NOT EXISTS skill_eval_runs (
      run_id        TEXT PRIMARY KEY,
      skill_name    TEXT NOT NULL,
      iteration     INTEGER,
      ran_at        TEXT NOT NULL,
      trigger_accuracy          REAL NOT NULL,
      functional_pass_rate      REAL NOT NULL,
      baseline_trigger_accuracy REAL,
      cases_json    TEXT NOT NULL,
      files_json    TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_skill_eval_runs_skill ON skill_eval_runs(skill_name, ran_at DESC);
  `);
  return db;
}

function rowToEvalRun(row: Record<string, unknown>): EvalRunDbRecord {
  let cases: StoredEvalCases = { trigger: [], functional: [] };
  try {
    const parsed = JSON.parse(String(row.cases_json ?? "{}")) as Partial<StoredEvalCases>;
    cases = {
      trigger: Array.isArray(parsed.trigger) ? (parsed.trigger as TriggerCaseResult[]) : [],
      functional: Array.isArray(parsed.functional) ? (parsed.functional as FunctionalCaseResult[]) : [],
    };
  } catch {
    // 损坏行兜底：逐例 JSON 解析失败不阻断列表查询
  }
  let files: string[] = [];
  try {
    const parsed = JSON.parse(String(row.files_json ?? "[]"));
    if (Array.isArray(parsed)) files = parsed.map((f) => String(f));
  } catch {
    // 同上：路径 JSON 损坏时按空数组处理
  }
  return {
    runId: String(row.run_id),
    skillName: String(row.skill_name),
    iteration: row.iteration == null ? null : Number(row.iteration),
    ranAt: String(row.ran_at),
    triggerAccuracy: Number(row.trigger_accuracy),
    functionalPassRate: Number(row.functional_pass_rate),
    baselineTriggerAccuracy: row.baseline_trigger_accuracy == null ? null : Number(row.baseline_trigger_accuracy),
    cases,
    files,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * 写入/更新一次评估运行（按 run_id upsert，保留原 created_at、刷新 updated_at）。
 * 返回完整落库记录（含 created_at/updated_at）。
 */
export function upsertEvalRun(record: Omit<EvalRunDbRecord, "createdAt" | "updatedAt">): EvalRunDbRecord {
  const db = openSkillEvalsDb();
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT created_at FROM skill_eval_runs WHERE run_id = ?").get(record.runId) as
    | { created_at: string }
    | undefined;
  const createdAt = existing?.created_at ?? now;
  db.prepare(
    `INSERT INTO skill_eval_runs (run_id, skill_name, iteration, ran_at, trigger_accuracy, functional_pass_rate, baseline_trigger_accuracy, cases_json, files_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET
       skill_name = excluded.skill_name,
       iteration = excluded.iteration,
       ran_at = excluded.ran_at,
       trigger_accuracy = excluded.trigger_accuracy,
       functional_pass_rate = excluded.functional_pass_rate,
       baseline_trigger_accuracy = excluded.baseline_trigger_accuracy,
       cases_json = excluded.cases_json,
       files_json = excluded.files_json,
       updated_at = excluded.updated_at`,
  ).run(
    record.runId,
    record.skillName,
    record.iteration,
    record.ranAt,
    record.triggerAccuracy,
    record.functionalPassRate,
    record.baselineTriggerAccuracy,
    JSON.stringify(record.cases),
    JSON.stringify(record.files),
    createdAt,
    now,
  );
  db.close();
  return { ...record, createdAt, updatedAt: now };
}

/** 最近 N 次运行（按 ran_at 倒序，含逐例明细）。 */
export function listEvalRuns(skillName: string, limit = 20): EvalRunDbRecord[] {
  const db = openSkillEvalsDb();
  const rows = db
    .prepare("SELECT * FROM skill_eval_runs WHERE skill_name = ? ORDER BY ran_at DESC LIMIT ?")
    .all(skillName, limit) as Record<string, unknown>[];
  db.close();
  return rows.map(rowToEvalRun);
}

/** 单次运行（含逐例明细）。不存在返回 null。 */
export function getEvalRun(runId: string): EvalRunDbRecord | null {
  const db = openSkillEvalsDb();
  const row = db.prepare("SELECT * FROM skill_eval_runs WHERE run_id = ?").get(runId) as
    | Record<string, unknown>
    | undefined;
  db.close();
  return row ? rowToEvalRun(row) : null;
}

/** syncEvalRun 入参：由 run_skill_evals 在 appendRun 旁增量调用。 */
export interface SyncEvalRunInput {
  skillName: string;
  /** 完整运行对象（逐例真实输出 / verdict 三态 / 依据在此持久化）。 */
  run: SkillEvalRun;
  /** 本次生成的 HTML 报告路径（trigger/functional）。 */
  reportPaths: { trigger: string; functional: string };
  /** iteration-N 工作区编号（无迭代则省略）。 */
  iteration?: number | null;
  /** 显式 runId（默认 `${skillName}-${triggeredAt}`，重跑自动换新）。 */
  runId?: string;
}

/**
 * run_skill_evals 的 SQLite 同步入口：把完整 run 对象连同报告路径
 * 写入 skill_eval_runs。history.json 的 appendRun 保持不动 —— 本函数
 * 只做增量补充，两处落盘语义互不干扰。
 */
export function syncEvalRun(input: SyncEvalRunInput): EvalRunDbRecord {
  const { skillName, run, reportPaths, iteration = null, runId = `${skillName}-${run.triggeredAt}` } = input;
  return upsertEvalRun({
    runId,
    skillName,
    iteration,
    ranAt: run.triggeredAt,
    triggerAccuracy: run.trigger.accuracy,
    functionalPassRate: run.functional.passRate,
    baselineTriggerAccuracy: run.baseline?.triggerAccuracy ?? null,
    cases: {
      trigger: run.trigger.cases,
      functional: run.functional.cases,
    },
    files: [reportPaths.trigger, reportPaths.functional],
  });
}
