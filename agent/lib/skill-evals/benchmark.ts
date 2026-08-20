/**
 * Benchmark（对照实验）评估：with/without skill、new/old skill 四配置对比。
 *
 * 对齐 skill-creator eval-review 形态：每个 (case, configuration, run) 做一次
 * 模拟执行 + 分析器评判（pass/fail + evidence），按 configuration 聚合
 * 通过率 / 耗时 / token 的统计（mean/stddev/min/max），供方差分析与
 * 「技能是否有效」的对照结论使用。
 * 与 functional.ts 的区别：functional 单配置（带技能）跑一次；benchmark
 * 多配置 × 多轮，衡量的是对比效应而非单点质量。
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { getAgentPaths } from "../../platform";
import { askEvalModel, askEvalModelJson } from "./llm";
import { loadSkill } from "./load";
import { DEFAULT_FUNCTIONAL_CASES } from "./functional";
import type {
  BenchmarkConfigurationStats,
  BenchmarkRun,
  BenchmarkStats,
  BenchmarkSummary,
  EvalConfiguration,
  FunctionalEvalCase,
} from "./types";

/** benchmark 用例 = functional 用例形态（任务输入 + 期望要点）。 */
export type BenchmarkCase = FunctionalEvalCase;

/** 内置默认用例：与 functional 评估共用同一批业务任务，保证两套评估口径一致。 */
export const DEFAULT_BENCHMARK_CASES: BenchmarkCase[] = DEFAULT_FUNCTIONAL_CASES;

/** 从技能包 evals.json 的 benchmark 字段读取用例，缺省（未声明或空）用内置默认。 */
export function loadBenchmarkCases(evalsJson?: { benchmark?: BenchmarkCase[] }): BenchmarkCase[] {
  const cases = evalsJson?.benchmark;
  return cases && cases.length > 0 ? cases : DEFAULT_BENCHMARK_CASES;
}

/** 空数组返回全 0；stddev 用总体标准差（÷n，0/1 通过率数据惯用）。 */
export function computeStats(values: number[]): BenchmarkStats {
  if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance), min: Math.min(...values), max: Math.max(...values) };
}

const EXECUTE_SYSTEM = `你是技能执行模拟器。给定技能 SKILL.md 的完整指令和一条用户任务，
按指令的步骤与口径「模拟执行」：输出该技能面对此任务应给出的回答结构
（不必真的查询数据库，但必须体现指令要求的判断逻辑、口径与结论形式）。
直接输出处理结果文本，不要解释过程。`;

/** without_skill：不给技能指令，仅靠模型基础能力回答。 */
const EXECUTE_SYSTEM_NO_SKILL = `你是业务分析助手。给定一条用户任务，按你的常识与领域知识直接给出处理结果。
直接输出结果文本，不要解释过程。`;

const JUDGE_SYSTEM = `你是技能输出评判器。给定技能指令、任务输入、期望输出要点、以及执行结果，
评判执行质量：只输出 JSON：{"pass": true|false, "evidence": ["依据1", ...]}。
- pass：结果完整覆盖期望要点且口径正确
- evidence：1-3 条简短中文依据，逐条说明各期望点的满足/缺失情况`;

interface BenchmarkVerdict {
  pass: boolean | string;
  evidence?: string[] | string;
}

/** 评判器 pass 字段容错（模型可能输出字符串而非布尔）。 */
function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "1", "pass", "通过"].includes(v)) return true;
    if (["false", "no", "0", "fail", "失败"].includes(v)) return false;
  }
  return Boolean(value);
}

/** evalId：用例输入前 24 字符，稳定可作 feedback key。 */
function evalIdOf(input: string): string {
  return input.slice(0, 24);
}

/**
 * 读 git HEAD 版本的 SKILL.md。
 * HEAD 无该文件（git 报错）或内容与当前相同 → 返回 null，调用方回退为
 * new_skill 相同语义（结果里不区分：不产生 old_skill 的 runs/stats）。
 */
async function loadOldSkillBody(skillName: string, currentBody: string): Promise<string | null> {
  const relPath = path.join("skill-packages", skillName, "SKILL.md");
  const stdout: string = await new Promise((resolve) => {
    execFile("git", ["show", `HEAD:${relPath}`], { cwd: getAgentPaths().repoRoot }, (error, out) => {
      if (error) return resolve("");
      resolve(String(out));
    });
  });
  if (!stdout || stdout.trimEnd() === currentBody.trimEnd()) return null;
  return stdout;
}

interface BenchmarkTask {
  configuration: EvalConfiguration;
  instruction: string | null;
  input: string;
  expected?: string;
  runNumber: number;
}

function buildExecutorPrompt(skillName: string, instruction: string | null, input: string): string {
  if (instruction === null) return `任务输入：${input}`;
  return `技能名：${skillName}\n技能指令：\n${instruction.slice(0, 6000)}\n\n任务输入：${input}`;
}

async function runOne(
  skillName: string,
  task: BenchmarkTask,
  evalId: string,
): Promise<BenchmarkRun> {
  const start = Date.now();
  try {
    const output = await askEvalModel(
      task.instruction === null ? EXECUTE_SYSTEM_NO_SKILL : EXECUTE_SYSTEM,
      buildExecutorPrompt(skillName, task.instruction, task.input),
      1500,
    );
    const judged = await askEvalModelJson<BenchmarkVerdict>(
      JUDGE_SYSTEM,
      `技能指令摘要：${(task.instruction ?? "（无技能指令，仅模型基础能力）").slice(0, 3000)}\n任务输入：${task.input}\n期望要点：${task.expected ?? "（未声明）"}\n\n执行输出：\n${output.slice(0, 3000)}`,
      500,
    );
    const evidence = Array.isArray(judged.evidence)
      ? judged.evidence.map(String).slice(0, 5)
      : [String(judged.evidence ?? "无依据")];
    return {
      evalId,
      configuration: task.configuration,
      runNumber: task.runNumber,
      input: task.input,
      output: output.slice(0, 800),
      pass: toBoolean(judged.pass),
      evidence,
      durationMs: Date.now() - start,
      // 无精确 token API，粗略估算：输出字符数 / 4
      tokens: Math.round(output.length / 4),
    };
  } catch (error) {
    return {
      evalId,
      configuration: task.configuration,
      runNumber: task.runNumber,
      input: task.input,
      output: "",
      pass: false,
      evidence: [`评估失败：${error instanceof Error ? error.message : String(error)}`],
      durationMs: Date.now() - start,
      tokens: 0,
    };
  }
}

function aggregateStats(runs: BenchmarkRun[]): BenchmarkConfigurationStats {
  return {
    passRate: computeStats(runs.map((r) => (r.pass ? 1 : 0))),
    timeSeconds: computeStats(runs.map((r) => r.durationMs / 1000)),
    tokens: computeStats(runs.map((r) => r.tokens)),
  };
}

/**
 * 跑 benchmark 对照实验。
 * 配置语义：
 * - with_skill / new_skill：当前 SKILL.md 全文作指令执行
 * - without_skill：不给技能指令，仅模型基础能力
 * - old_skill：git HEAD 版本的 SKILL.md 作指令；HEAD 无该文件或同内容时
 *   回退（不执行、结果里不出现 old_skill，即与只跑 new_skill 相同）
 * 并发：同一轮各任务并行，Promise.all 上限 4。
 */
export async function runBenchmark(
  skillName: string,
  opts?: { runsPerConfiguration?: number; cases?: BenchmarkCase[] },
): Promise<BenchmarkSummary> {
  const runsPerConfiguration = opts?.runsPerConfiguration ?? 3;
  const cases = opts?.cases && opts.cases.length > 0 ? opts.cases : DEFAULT_BENCHMARK_CASES;
  const skill = loadSkill(skillName);

  const oldSkillBody = await loadOldSkillBody(skillName, skill.body);
  const configurations: { configuration: EvalConfiguration; instruction: string | null }[] = [
    { configuration: "with_skill", instruction: skill.body },
    { configuration: "without_skill", instruction: null },
    { configuration: "new_skill", instruction: skill.body },
  ];
  // old_skill 回退时（HEAD 无文件或同内容）不产生该配置，结果里不区分
  if (oldSkillBody !== null) {
    configurations.push({ configuration: "old_skill", instruction: oldSkillBody });
  }

  const tasks: BenchmarkTask[] = [];
  for (const { configuration, instruction } of configurations) {
    for (const c of cases) {
      for (let runNumber = 1; runNumber <= runsPerConfiguration; runNumber++) {
        tasks.push({ configuration, instruction, input: c.input, expected: c.expected, runNumber });
      }
    }
  }

  const runs: BenchmarkRun[] = [];
  const concurrency = 4;
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((task) => runOne(skillName, task, evalIdOf(task.input))),
    );
    runs.push(...batchResults);
  }

  const stats: BenchmarkSummary["stats"] = {};
  for (const { configuration } of configurations) {
    stats[configuration] = aggregateStats(runs.filter((r) => r.configuration === configuration));
  }

  const expectations: BenchmarkSummary["expectations"] = {};
  for (const c of cases) {
    const evalId = evalIdOf(c.input);
    const caseRuns = runs.filter((r) => r.evalId === evalId);
    expectations[evalId] = {
      text: c.expected ?? "（未声明）",
      passed: caseRuns.length > 0 && caseRuns.every((r) => r.pass),
      evidence: Array.from(new Set(caseRuns.flatMap((r) => r.evidence))).slice(0, 10),
    };
  }

  const model = process.env.OPENCODE_GO_MODEL?.trim() || "deepseek-v4-flash";
  return {
    skillName,
    runsPerConfiguration,
    caseCount: cases.length,
    metadata: {
      executorModel: model,
      analyzerModel: model,
      evalsRun: new Date().toISOString(),
    },
    runs,
    stats,
    expectations,
  };
}
