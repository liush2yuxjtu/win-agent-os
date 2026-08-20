/**
 * 易混淆负例自动生成工具：按技能 description + 现有 trigger 用例（正例/负例），
 * 让评估模型生成 count 个「易混淆负例」候选 —— 与正例语义相近（同领域、同关键词、
 * 同句式）但不应触发该技能的提问，每条附一句为什么不应触发。
 *
 * 只生成候选、不自动落盘：返回列表供用户确认（用户说「应用」时再经 add_eval_case 写入）。
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { loadSkill } from "../lib/skill-evals/load";
import { askEvalModel } from "../lib/skill-evals/llm";

interface NegativeCandidate {
  query: string;
  reason: string;
}

/** 容错解析模型返回的 JSON 数组：剥围栏 → 整体 parse → 提取 [ ] → { candidates: [...] } 包装。 */
function parseCandidates(raw: string): NegativeCandidate[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const tryParse = (text: string): NegativeCandidate[] | null => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((e): e is { query: string; reason: string } =>
            typeof e === "object" && e !== null && typeof (e as { query?: unknown }).query === "string" && typeof (e as { reason?: unknown }).reason === "string",
          )
          .map((e) => ({ query: e.query.trim(), reason: e.reason.trim() }));
      }
      if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { candidates?: unknown }).candidates)) {
        const candidates = (parsed as { candidates: unknown[] }).candidates;
        return candidates
          .filter((e): e is { query: string; reason: string } =>
            typeof e === "object" && e !== null && typeof (e as { query?: unknown }).query === "string" && typeof (e as { reason?: unknown }).reason === "string",
          )
          .map((e) => ({ query: e.query.trim(), reason: e.reason.trim() }));
      }
      return null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(cleaned);
  if (direct) return direct;

  // 退化：提取第一个 [ 到最后一个 ]（模型可能前后带了说明文字）
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) {
    const fromArray = tryParse(cleaned.slice(start, end + 1));
    if (fromArray) return fromArray;
  }
  throw new Error(`模型未返回可解析的 JSON 数组：${raw.slice(0, 200)}`);
}

export default defineTool({
  description:
    "给指定技能自动生成「易混淆负例」候选：基于技能 description 和现有 trigger 正/负例，让评估模型产出与正例语义相近（同领域、同关键词、同句式）但不应触发该技能的提问。只生成候选不落盘，用户确认后可经 add_eval_case 写入。用户要求「给 XX 技能生成点容易混淆的负例/坑人的测试用例/凑点难负例」时使用。",
  inputSchema: z.object({
    skillName: z.string().describe("技能名（skill-packages/ 下的目录名，如 ai-control）"),
    count: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("要生成的负例数量，默认 5，最多 10"),
  }),
  async execute({ skillName, count = 5 }) {
    let skill;
    try {
      skill = loadSkill(skillName);
    } catch (error) {
      return { ok: false, error: `读取技能失败：${error instanceof Error ? error.message : String(error)}` };
    }

    const triggerCases = skill.evals?.trigger ?? [];
    const positives = triggerCases.filter((c) => c.expectedTrigger).map((c) => c.prompt);
    const existingNegatives = triggerCases.filter((c) => !c.expectedTrigger).map((c) => c.prompt);

    if (positives.length === 0) {
      return { ok: false, error: `技能 ${skillName} 没有 trigger 正例（evals/trigger-evals.json 中 should_trigger=true 的用例），无法生成易混淆负例` };
    }

    const system = `你是技能触发评估的负例设计专家。你的任务是为指定技能设计「易混淆负例」：这些提问与技能的正例语义相近（同领域、同关键词、同句式），但仔细看需求其实不应触发该技能。

关键方法论：负例要 genuinely tricky —— 与正例共享关键词但需求不同。常见可复用类型：
- 汇总/看板类：只要一个整体概览或数据汇总，不要技能的分析动作
- 候选盘点类：只列候选名单/盘点现状，不做技能要求的问题诊断
- 执行操作类：直接要落地动作（加预算、改计划、下素材），不是分析诊断
- 需求不同类：问的是别的技能/别的分析对象，只是顺带提到了本技能的领域词
不要生成「明显不相关的提问」（如闲聊、完全无关领域），那种不是易混淆负例；也不要与已有负例重复。

输出严格为 JSON 数组，不要任何额外文字：[{"query": "...", "reason": "..."}]，其中 query 是中文口语化提问（具体，含业务词/数字/场景），reason 是一句「为什么不应触发」的简短解释。`;

    const prompt = `技能名称：${skill.name}
技能 description：${skill.description}

现有正例（应触发的提问）：
${positives.map((p) => `- ${p}`).join("\n") || "（无）"}

已有负例（不应触发的提问，请避免重复）：
${existingNegatives.map((p) => `- ${p}`).join("\n") || "（无）"}

请生成 ${count} 个易混淆负例：与正例语义相近（同领域、同关键词、同句式）但不应触发「${skill.name}」技能的提问。要求：
1. 中文口语化，像真实用户会说的话
2. 具体：包含业务词、数字或具体场景，不要空泛
3. 与上面的已有负例不重复（内容、意图都不同）
4. 每条附一句「为什么不应触发」的理由

只输出 JSON 数组：[{"query": "...", "reason": "..."}]，共 ${count} 条。`;

    let raw: string;
    try {
      raw = await askEvalModel(system, prompt, 2500);
    } catch (error) {
      return { ok: false, error: `生成失败（模型调用出错）：${error instanceof Error ? error.message : String(error)}` };
    }

    let candidates: NegativeCandidate[];
    try {
      candidates = parseCandidates(raw);
    } catch (error) {
      return { ok: false, error: `生成失败（输出解析失败）：${error instanceof Error ? error.message : String(error)}` };
    }

    if (candidates.length === 0) {
      return { ok: false, error: "生成失败：模型返回了空数组或没有可用的 {query, reason} 条目" };
    }

    // 去重：与已有负例精确重复、候选内部重复 → 过滤；数量裁剪到 count
    const seen = new Set(existingNegatives.map((q) => q.trim()));
    const deduped: NegativeCandidate[] = [];
    for (const c of candidates) {
      if (c.query === "") continue;
      if (seen.has(c.query)) continue;
      seen.add(c.query);
      deduped.push(c);
      if (deduped.length >= count) break;
    }

    return {
      ok: true,
      skillName: skill.name,
      existing: { positive: positives.length, negative: existingNegatives.length },
      candidates: deduped,
    };
  },
});
