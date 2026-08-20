import { defineTool } from "eve/tools";
import { z } from "zod";
import { loadSkill } from "../lib/skill-evals/load";
import { runTriggerEval } from "../lib/skill-evals/trigger";
import { askEvalModelJson } from "../lib/skill-evals/llm";

/**
 * 触发描述优化工具：以技能的 trigger 用例为基准，内部多轮迭代改进 description。
 *
 * 流程：跑基线 trigger eval → 收集失败用例（漏触发/误触发，含模型判定理由）→
 * 交给评估模型生成一批改进版 description 候选 → 逐个对全部 trigger 用例重跑实测打分 →
 * 把本轮最优作为下一轮基线继续生成/评测（默认 3 轮，命中率 100% 或候选无改进即提前停止）→
 * 返回逐轮触发率证据（每轮基线/候选得分/失败用例）与最优候选。
 * 不自动写回 SKILL.md（写回由用户确认后手动执行）。
 */

interface CandidateScore {
  description: string;
  accuracy: number;
  passed: number;
  total: number;
}

interface FailedCaseEvidence {
  prompt: string;
  expectedTrigger: boolean;
  predictedTrigger: boolean;
  reason: string;
}

interface RoundEvidence {
  round: number;
  /** 本轮起点 description（第 1 轮为技能原 description，之后为上一轮最优候选）。 */
  baseDescription: string;
  /** 本轮起点触发率实测。 */
  base: { accuracy: number; passed: number; total: number };
  /** 本轮起点下的失败用例（漏触发/误触发 + 模型判定理由）。 */
  failedCases: FailedCaseEvidence[];
  /** 本轮生成的候选及其实测触发率（降序）。 */
  candidates: CandidateScore[];
  /** 本轮最优候选（未超过本轮基线时为 null）。 */
  best: CandidateScore | null;
  /** 本轮是否有候选触发率超过本轮起点。 */
  improved: boolean;
}

export default defineTool({
  description:
    "优化一个技能的触发描述（SKILL.md frontmatter 的 description，即触发路由依据）：以技能的 trigger 用例（evals/trigger-evals.json）为基准，内部多轮迭代改进——每轮先跑基线触发率，收集失败用例（漏触发/误触发，含模型判定理由），生成一批改进版 description 候选（保留触发场景覆盖、明确排除误触发场景、中文、150 字内），再逐个对全部 trigger 用例重跑模型判定实测打分；本轮最优作为下一轮基线继续精修（默认 3 轮、每轮 3 个候选，命中率 100% 或候选无改进即提前停止）。返回逐轮触发率证据（每轮基线→候选得分轨迹、失败用例清单）与最优候选（不自动写回 SKILL.md，展示给用户确认后应用，可用 publish_skill 重新上架）。用户要求「优化 XX 技能的触发描述/description」「提高 XX 技能的触发准确率」「这个技能的触发描述怎么改进」，或 run_skill_evals 显示触发准确率不理想需要改进 description 时使用。技能没有 trigger 用例时会报错，需先调用 add_eval_case 添加。调用前先告知用户预计耗时：约 轮数 × 候选数 × 用例数 次模型判定（默认 3 轮 × 3 候选，通常 2-8 分钟）。",
  inputSchema: z.object({
    skillName: z.string().describe("技能名（skill-packages/ 下的目录名，如 ai-control）"),
    maxCandidates: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("每轮改进版 description 候选数量（默认 3，候选越多耗时越长）"),
    maxRounds: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("迭代轮数（默认 3，最多 5；每轮把上一轮最优候选作为基线继续生成，命中率 100% 或候选无改进时提前停止）"),
  }),
  async execute({ skillName, maxCandidates = 3, maxRounds = 3 }) {
    try {
      // 1. 读技能当前 description + trigger 用例（无用例报错，引导先补用例）
      const skill = loadSkill(skillName);
      const cases = skill.evals?.trigger;
      if (!cases || cases.length === 0) {
        return {
          ok: false,
          skillName,
          error: `技能 ${skillName} 没有 trigger 用例（evals/trigger-evals.json），请先调用 add_eval_case 添加用例再优化`,
        };
      }

      // 2. 基线触发率（第 1 轮起点）；全命中直接收尾
      let baseRun = await runTriggerEval(skillName, skill.description, cases);
      const baseline = { accuracy: baseRun.accuracy, passed: baseRun.passed, total: baseRun.total };
      if (baseline.passed === baseline.total) {
        return {
          ok: true,
          skillName,
          baseline,
          rounds: [],
          candidates: [],
          best: null,
          message: `当前 description 已 100% 命中全部 ${baseline.total} 条 trigger 用例，无需优化（可先补充更难用例再跑）`,
        };
      }

      // 3. 多轮迭代：每轮生成候选并实测打分，最优作为下一轮基线
      const rounds: RoundEvidence[] = [];
      const allCandidates: CandidateScore[] = [];
      const evaluatedSet = new Set<string>();
      let baseDescription = skill.description;

      for (let round = 1; round <= maxRounds; round += 1) {
        if (round > 1) baseRun = await runTriggerEval(skillName, baseDescription, cases);
        const roundBase = { accuracy: baseRun.accuracy, passed: baseRun.passed, total: baseRun.total };

        // 本轮基线已全命中 → 提前收尾
        const failed = baseRun.cases.filter((c) => !c.pass);
        if (failed.length === 0) {
          rounds.push({
            round,
            baseDescription,
            base: roundBase,
            failedCases: [],
            candidates: [],
            best: null,
            improved: false,
          });
          break;
        }

        // 生成候选（携带失败用例 + 已尝试候选防重复）
        const failureList = failed
          .map(
            (c, i) =>
              `${i + 1}. 提问：${c.prompt}\n` +
              `   期望：${c.expectedTrigger ? "应触发" : "不应触发"}，实际判定：${c.predictedTrigger ? "触发" : "不触发"}\n` +
              `   模型判定理由：${c.reason || "（无）"}`,
          )
          .join("\n");
        const triedList = [...evaluatedSet].map((d, i) => `${i + 1}. ${d}`).join("\n");
        const rawCandidates = await askEvalModelJson<string[]>(
          GENERATE_SYSTEM,
          `技能名：${skillName}\n当前 description（第 ${round} 轮基线）：\n${baseDescription}\n\n` +
            `trigger 评估失败用例（模型按当前 description 判定与期望不符）：\n${failureList}\n\n` +
            (triedList ? `已尝试过的候选（不要重复生成）：\n${triedList}\n\n` : "") +
            `请生成 ${maxCandidates} 个改进版 description 候选，只输出 JSON 字符串数组（不要输出其他文字）。`,
          4000,
        );
        const candidates = (Array.isArray(rawCandidates) ? rawCandidates : [])
          .filter((d): d is string => typeof d === "string")
          .map((d) => d.trim())
          .filter((d) => d.length > 0)
          .slice(0, maxCandidates);

        // 逐候选实测打分（已评过的候选直接复用前次得分）
        const evaluated: CandidateScore[] = [];
        for (const description of candidates) {
          const existing = allCandidates.find((c) => c.description === description);
          if (existing) {
            evaluated.push(existing);
            continue;
          }
          const run = await runTriggerEval(skillName, description, cases);
          evaluatedSet.add(description);
          const score = { description, accuracy: run.accuracy, passed: run.passed, total: run.total };
          evaluated.push(score);
          allCandidates.push(score);
        }
        evaluated.sort((a, b) => b.accuracy - a.accuracy || b.passed - a.passed);

        const top = evaluated[0];
        if (!top) break; // 模型未生成有效候选 → 停止
        const improved = top.accuracy > roundBase.accuracy;
        rounds.push({
          round,
          baseDescription,
          base: roundBase,
          failedCases: failed.map((c) => ({
            prompt: c.prompt,
            expectedTrigger: c.expectedTrigger,
            predictedTrigger: c.predictedTrigger,
            reason: c.reason,
          })),
          candidates: evaluated,
          best: improved ? top : null,
          improved,
        });
        if (!improved) break; // 本轮无候选超过基线 → 再轮只会面对同样失败集，边际递减，停止
        baseDescription = top.description; // 下一轮以此为基线继续精修
        if (top.accuracy >= 1) break;
      }

      // 4. 汇总：全部候选跨轮降序，best = 最高准确率且超过原基线者
      allCandidates.sort((a, b) => b.accuracy - a.accuracy || b.passed - a.passed);
      const best = allCandidates[0] ?? null;
      const improved = best !== null && best.accuracy > baseline.accuracy;
      const trajectory = rounds
        .map((r) =>
          `第 ${r.round} 轮：基线 ${Math.round(r.base.accuracy * 100)}%` +
          (r.improved ? ` → 最优 ${Math.round((r.best?.accuracy ?? 0) * 100)}%` : " → 无改进"),
        )
        .join("；");
      return {
        ok: true,
        skillName,
        baseline,
        rounds,
        candidates: allCandidates,
        best: improved
          ? { description: best.description, accuracy: best.accuracy, improved: true }
          : null,
        message: improved
          ? `触发率轨迹：${trajectory}。最优候选 ${Math.round(best.accuracy * 100)}%（${best.passed}/${best.total} 例）> 基线 ${Math.round(baseline.accuracy * 100)}%（${baseline.passed}/${baseline.total} 例），可将 best.description 应用到 SKILL.md 后重跑 run_skill_evals 验证`
          : `无改进：${trajectory}。所有候选准确率均未超过基线 ${Math.round(baseline.accuracy * 100)}%（${baseline.passed}/${baseline.total} 例），可考虑补充更难的 trigger 用例（add_eval_case）后再优化`,
      };
    } catch (error) {
      return {
        ok: false,
        skillName,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

const GENERATE_SYSTEM = `你是技能触发描述优化器。技能 description 是 agent 决定「何时加载该技能」的唯一依据，写得好坏直接影响触发准确率（漏触发 = 该用没用，误触发 = 不该用却用了）。

给定技能的当前 description 与 trigger 评估失败用例（模型对它们误判了应否触发），生成多个改进版 description 候选。每个候选必须同时满足：
1. 保留并强化原有触发场景覆盖——失败的正例（应触发却没触发）要能被明确命中，可用更贴切的场景词、触发句式（如「当用户需要……时」「用户提到……」）；
2. 明确排除误触发场景——失败的负例（不应触发却触发）要写出不触发的场景或句式（如「仅 XX 场景」「XX 需求不在此列」）；
3. 用中文写；
4. 150 字以内；
5. 完整独立，不依赖上下文；
6. 只输出 JSON 字符串数组（如 ["候选一", "候选二"]），不要任何解释文字；
7. 若提示里给出「已尝试过的候选」，不要生成与之重复或近义重复的候选。`;
