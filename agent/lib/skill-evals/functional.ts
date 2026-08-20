/**
 * Functional eval：评估技能指令的执行质量。
 *
 * 对每个任务用例，模型按技能 SKILL.md 的完整指令处理输入（模拟执行：
 * 不真正调用数据源，按指令口径生成应输出的分析/结论结构），
 * 再由评判模型按期望要点打分 → pass / partial / fail + 说明。
 * 这是「提高功能」的评估——指令写得是否清晰、口径是否完整、输出是否达标。
 *
 * 两种执行模式：
 * - simulate（默认）：模型按指令逻辑模拟输出，不要求贴近真实查询产物。
 * - live：模型按技能真实查询口径组织回答——引用动态最新数据日期、真实表/字段名、
 *   动态品线基线与基线比较逻辑，输出与真实执行产物同构（仍不实际查库）。
 */
import { askEvalModel, askEvalModelJson } from "./llm";
import type { EvalExecutionResult, FunctionalCaseResult, FunctionalEvalCase } from "./types";

export const DEFAULT_FUNCTIONAL_CASES: FunctionalEvalCase[] = [
  { input: "帮我分析这个品线最近的素材表现并给出追投建议", expected: "引用最新数据日期、按基线判断、结论可执行", note: "通用业务分析任务" },
  { input: "盘点哪些素材达到追投门槛", expected: "明确候选清单、给出判断依据", note: "候选盘点任务" },
];

/** functional eval 执行模式：simulate=模拟执行（默认），live=按真实查询口径回答。 */
export type FunctionalMode = "simulate" | "live";

/** 单例结果：携带 mode 标记（在 FunctionalCaseResult 上扩展，不依赖 types.ts）。 */
export type FunctionalCaseResultWithMode = FunctionalCaseResult & { mode: FunctionalMode };

const EXECUTE_SYSTEM = `你是技能执行模拟器。给定技能 SKILL.md 的完整指令和一条用户任务，
按指令的步骤与口径「模拟执行」：输出该技能面对此任务应给出的回答结构
（不必真的查询数据库，但必须体现指令要求的判断逻辑、口径与结论形式）。
直接输出处理结果文本，不要解释过程。`;

/** 组装执行 prompt：live 模式在任务段末尾追加真实查询口径说明（system 保持稳定句式）。 */
function buildExecutePrompt(mode: FunctionalMode, skillName: string, skillBody: string, input: string): string {
  const liveNote =
    mode === "live"
      ? `\n\n【live 模式】按技能真实查询口径回答：现场标注动态最新数据日期（MAX(STAT_TIME)，不硬编码）、使用技能指定的真实表名/字段名、品线基线动态获取并按识别条件比较、证据清单与金额齐全。直接输出最终回答，不要复述本说明。`
      : "";
  return `技能名：${skillName}\n技能指令：\n${skillBody.slice(0, 6000)}\n\n任务输入：${input}${liveNote}`;
}

const JUDGE_SYSTEM_SIMULATE = `你是技能输出评判器。给定技能指令、任务输入、期望输出要点、以及模拟执行的结果，
评判执行质量：只输出 JSON：{"verdict": "pass"|"partial"|"fail", "reason": "一句简短中文依据"}。
- pass：结果完整覆盖期望要点且口径正确
- partial：部分覆盖或有轻微口径偏差
- fail：明显缺失关键步骤、口径错误或答非所问`;

const JUDGE_SYSTEM_LIVE = `你是技能输出评判器。给定技能指令、任务输入、期望输出要点、以及 live 模式的执行结果
（按技能真实查询口径模拟生成的回答：动态日期、真实表/字段名、动态基线比较），
评判执行质量：只输出 JSON：{"verdict": "pass"|"partial"|"fail", "reason": "一句简短中文依据"}。
- pass：结果完整覆盖期望要点且口径正确（含动态数据日期、真实表/字段名、基线比较逻辑）
- partial：部分覆盖或有轻微口径偏差
- fail：明显缺失关键步骤、口径错误或答非所问`;

interface FunctionalVerdict {
  verdict: "pass" | "partial" | "fail";
  reason: string;
}

/** 注入的外部执行输出存储上限：真实执行产物比模拟更长，放宽到 3000 字符供人工评审。 */
const INJECTED_OUTPUT_CAP = 3000;

/**
 * 外部执行结果注入路径：跳过内部 LLM 模拟执行与评判，逐例采用注入的 verdict/evidence/output。
 * 匹配优先级：按注入结果 input 精确匹配用例 → 按注入结果 caseId 匹配用例 input；
 * 未命中的用例标记 fail 并注明（保持 total == 用例数，供汇总与 HTML 使用）。
 */
function applyInjectedResults(
  cases: FunctionalEvalCase[],
  executionResults: EvalExecutionResult[],
  mode: FunctionalMode,
): FunctionalCaseResultWithMode[] {
  const byInput = new Map<string, EvalExecutionResult>();
  const byCaseId = new Map<string, EvalExecutionResult>();
  for (const r of executionResults) {
    byInput.set(r.input, r);
    if (r.caseId) byCaseId.set(r.caseId, r);
  }
  return cases.map((c) => {
    const injected = byInput.get(c.input) ?? byCaseId.get(c.input);
    if (!injected) {
      return {
        input: c.input,
        output: "",
        verdict: "fail",
        reason: `未注入该用例的外部执行结果（共注入 ${executionResults.length} 条且无匹配）——已跳过内部判定，请人工评审`,
        expected: c.expected,
        mode,
        source: "injected",
      } satisfies FunctionalCaseResultWithMode;
    }
    return {
      input: c.input,
      output: injected.output.slice(0, INJECTED_OUTPUT_CAP),
      verdict: injected.verdict,
      reason: injected.evidence ?? "",
      expected: c.expected,
      mode,
      source: "injected",
    } satisfies FunctionalCaseResultWithMode;
  });
}

/** 跑 functional eval（并发 3，每例执行+评判）。mode="live" 时按真实查询口径模拟执行。
 *  传入 executionResults（外部执行结果注入）时跳过内部 LLM 模拟执行与评判，直接采用注入结果；不传时行为不变。 */
export async function runFunctionalEval(
  skillName: string,
  skillBody: string,
  cases: FunctionalEvalCase[],
  mode: FunctionalMode = "simulate",
  executionResults?: EvalExecutionResult[],
): Promise<{ total: number; passed: number; partial: number; failed: number; passRate: number; cases: FunctionalCaseResultWithMode[] }> {
  const injected = executionResults !== undefined && executionResults.length > 0;
  if (injected) {
    const results = applyInjectedResults(cases, executionResults, mode);
    const passed = results.filter((r) => r.verdict === "pass").length;
    const partial = results.filter((r) => r.verdict === "partial").length;
    const failed = results.filter((r) => r.verdict === "fail").length;
    return {
      total: results.length,
      passed,
      partial,
      failed,
      passRate: results.length > 0 ? passed / results.length : 0,
      cases: results,
    };
  }

  const judgeSystem = mode === "live" ? JUDGE_SYSTEM_LIVE : JUDGE_SYSTEM_SIMULATE;
  const results: FunctionalCaseResultWithMode[] = [];
  const concurrency = 3;
  for (let i = 0; i < cases.length; i += concurrency) {
    const batch = cases.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (c) => {
        // 执行与评判分离容错：执行输出（模拟回答）是评审材料，评判失败也不丢弃
        let output = "";
        try {
          output = await askEvalModel(
            EXECUTE_SYSTEM,
            buildExecutePrompt(mode, skillName, skillBody, c.input),
            1500,
          );
        } catch (error) {
          return {
            input: c.input,
            output: "",
            verdict: "fail",
            reason: `执行失败：${error instanceof Error ? error.message : String(error)}`,
            expected: c.expected,
            mode,
          } satisfies FunctionalCaseResultWithMode;
        }
        try {
          const judged = await askEvalModelJson<FunctionalVerdict>(
            judgeSystem,
            `技能指令摘要：${skillBody.slice(0, 3000)}\n任务输入：${c.input}\n期望要点：${c.expected ?? "（未声明）"}\n\n${mode === "live" ? "live 模式（按真实查询口径）" : "模拟"}执行输出：\n${output.slice(0, 3000)}`,
            400,
          );
          return {
            input: c.input,
            // live 输出更接近真实交付物、篇幅更长：放宽存储上限，避免截断让评判失真
            output: output.slice(0, mode === "live" ? 1500 : 800),
            verdict: judged.verdict,
            reason: judged.reason ?? "",
            expected: c.expected,
            mode,
          } satisfies FunctionalCaseResultWithMode;
        } catch (error) {
          // 评判 JSON 解析失败：保留执行输出供人工评审，判定降级 fail 并注明
          return {
            input: c.input,
            output: output.slice(0, mode === "live" ? 1500 : 800),
            verdict: "fail",
            reason: `评判失败（${error instanceof Error ? error.message : String(error)}）——执行输出已保留，请人工评审`,
            expected: c.expected,
            mode,
          } satisfies FunctionalCaseResultWithMode;
        }
      }),
    );
    results.push(...batchResults);
  }

  const passed = results.filter((r) => r.verdict === "pass").length;
  const partial = results.filter((r) => r.verdict === "partial").length;
  const failed = results.filter((r) => r.verdict === "fail").length;
  return {
    total: results.length,
    passed,
    partial,
    failed,
    passRate: results.length > 0 ? passed / results.length : 0,
    cases: results,
  };
}

/** 从技能包读取 functional 用例，缺省用内置默认。 */
export function loadFunctionalCases(evalsJson?: { functional?: FunctionalEvalCase[] }): FunctionalEvalCase[] {
  const cases = evalsJson?.functional;
  return cases && cases.length > 0 ? cases : DEFAULT_FUNCTIONAL_CASES;
}
