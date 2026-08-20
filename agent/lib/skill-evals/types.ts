/** 技能评估数据模型：trigger（触发准确性）+ functional（功能正确性）。 */

/** 触发评估用例：一条用户提问 + 期望的触发判定。 */
export interface TriggerEvalCase {
  /** 用户提问（正例：应触发；负例：不应触发）。 */
  prompt: string;
  /** true = 该提问应触发此技能；false = 不应触发。 */
  expectedTrigger: boolean;
  /** 用例说明（为什么是正例/负例）。 */
  note?: string;
}

/** 功能评估用例：一个业务输入 + 期望输出要点。 */
export interface FunctionalEvalCase {
  /** 任务输入（发给技能处理的业务问题）。 */
  input: string;
  /** 期望输出要点（评判标准，逗号分隔）。 */
  expected?: string;
  /** 用例说明。 */
  note?: string;
}

/** 技能声明的评估配置（evals.json 结构）。 */
export interface SkillEvalsFile {
  trigger?: TriggerEvalCase[];
  functional?: FunctionalEvalCase[];
}

/** 单例 trigger 判定结果。 */
export interface TriggerCaseResult {
  prompt: string;
  expectedTrigger: boolean;
  /** 模型判定是否触发。 */
  predictedTrigger: boolean;
  /** 判定依据（模型给出的简短理由）。 */
  reason: string;
  /** 是否命中期望。 */
  pass: boolean;
}

/** 单例 functional 判定结果。 */
export interface FunctionalCaseResult {
  input: string;
  /** 模型按技能指令给出的处理输出摘要。 */
  output: string;
  /** 评判：pass / partial / fail。 */
  verdict: "pass" | "partial" | "fail";
  /** 评判说明。 */
  reason: string;
  expected?: string;
  /** 结果来源：缺省 = 内部 LLM 模拟执行+评判；"injected" = 外部注入的真实执行结果（eval-runner 子代理产出）。 */
  source?: "simulate" | "injected";
}

/**
 * 外部注入的功能评估执行结果：由 eval-runner 子代理（真实 agent 执行）产出。
 * 注入后 runFunctionalEval / runSkillEvals 跳过内部 LLM 模拟执行与评判，直接采用该结果。
 */
export interface EvalExecutionResult {
  /** 用例标识：匹配键之一（缺省或 input 未命中时按本字段匹配 FunctionalEvalCase.input）。 */
  caseId?: string;
  /** 用例输入（FunctionalEvalCase.input 的原文，主匹配键）。 */
  input: string;
  /** 执行判定：pass / partial / fail。 */
  verdict: "pass" | "partial" | "fail";
  /** 判定依据（执行器给出的证据/理由，写入 FunctionalCaseResult.reason）。 */
  evidence: string;
  /** 执行输出全文（评审材料，写入 FunctionalCaseResult.output）。 */
  output: string;
}

/** 一次完整评估运行的输出（喂给 HTML 生成器与聊天渲染）。 */
export interface SkillEvalRun {
  skillName: string;
  skillDescription: string;
  triggeredAt: string;
  trigger: {
    total: number;
    passed: number;
    /** 命中率 0-1。 */
    accuracy: number;
    /** 误触发（应 false 判 true）数。 */
    falsePositives: number;
    /** 漏触发（应 true 判 false）数。 */
    falseNegatives: number;
    cases: TriggerCaseResult[];
  };
  functional: {
    total: number;
    passed: number;
    partial: number;
    failed: number;
    /** 通过率（pass / total）0-1。 */
    passRate: number;
    cases: FunctionalCaseResult[];
  };
  /** 无技能基线：同一组 trigger 用例 + 占位 description 的触发率，量化技能描述带来的提升。 */
  baseline?: {
    /** 基线触发率 0-1。 */
    triggerAccuracy: number;
  };
}

// ---------------------------------------------------------------------------
// Benchmark（对照实验）——对齐 skill-creator eval-review 形态
// ---------------------------------------------------------------------------

/** 对照配置：with/without skill、new/old skill。 */
export type EvalConfiguration = "with_skill" | "without_skill" | "new_skill" | "old_skill";

export interface BenchmarkRun {
  /** 用例 id（用例输入的前 24 字符 hash 或序号）。 */
  evalId: string;
  configuration: EvalConfiguration;
  /** 该配置下的第几次运行（1..runsPerConfiguration）。 */
  runNumber: number;
  /** 任务输入。 */
  input: string;
  /** 执行输出（截断）。 */
  output: string;
  /** 自动评分是否通过（分析器按期望评判）。 */
  pass: boolean;
  /** 评分依据（evidence 列表）。 */
  evidence: string[];
  durationMs: number;
  tokens: number;
}

export interface BenchmarkStats {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

export interface BenchmarkConfigurationStats {
  /** 通过率统计（0-1）。 */
  passRate: BenchmarkStats;
  /** 耗时统计（秒）。 */
  timeSeconds: BenchmarkStats;
  /** token 统计。 */
  tokens: BenchmarkStats;
}

export interface BenchmarkSummary {
  skillName: string;
  runsPerConfiguration: number;
  caseCount: number;
  metadata: {
    executorModel: string;
    analyzerModel: string;
    evalsRun: string;
  };
  runs: BenchmarkRun[];
  /** configuration → 统计。 */
  stats: Partial<Record<EvalConfiguration, BenchmarkConfigurationStats>>;
  /** 期望要点（per evalId）。 */
  expectations: Record<string, { text: string; passed: boolean; evidence: string[] }>;
}
