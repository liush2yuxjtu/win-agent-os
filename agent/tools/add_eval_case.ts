import fs from "node:fs";
import path from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getAgentPaths } from "../platform";

/** 用例双文件约定（与 skill-creator / onepager 一致）。 */
const EVALS_FILE = "evals/evals.json";            // functional：{ skill_name, evals: [{ id, name, prompt, expected_output, expectations }] }
const TRIGGER_FILE = "evals/trigger-evals.json";  // trigger：数组 [{ query, should_trigger }]

function readJsonOrNull(file: string): unknown | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/**
 * 技能评估用例维护工具：按需为指定技能新增 trigger 或 functional 用例，
 * 写入 evals/trigger-evals.json 或 evals/evals.json（双文件约定，格式由工具保证）。
 * 新增后可直接跑 run_skill_evals 验证。
 */
export default defineTool({
  description:
    "给指定技能新增一条评估用例（trigger 或 functional），追加到技能的 evals/trigger-evals.json 或 evals/evals.json（格式由工具保证，勿用 write_file 手写）。用户要求「给 XX 技能加个测试用例/评估用例」，或评估暴露缺口需要补用例（如触发漏判、负例缺失）时使用。新增后可调用 run_skill_evals 重跑验证。",
  inputSchema: z.object({
    skillName: z.string().describe("技能名（skill-packages/ 下的目录名，如 ai-control）"),
    evalType: z.enum(["trigger", "functional"]).describe("trigger = 触发命中用例（query + should_trigger）；functional = 功能执行用例（prompt + expected_output）"),
    query: z.string().describe("用例输入：trigger 用 query（用户提问原文），functional 用 prompt（业务任务输入）"),
    shouldTrigger: z.boolean().optional().describe("仅 trigger 用：true = 该提问应触发此技能；false = 不应触发（负例）"),
    expectedOutput: z.string().optional().describe("仅 functional 用：期望输出要点（评判标准，如「引用最新数据日期、按品线基线判断、结论可执行」）"),
    note: z.string().optional().describe("用例说明（为什么是正例/负例，或功能场景名）"),
  }),
  async execute({ skillName, evalType, query, shouldTrigger, expectedOutput, note }) {
    const skillDir = path.join(getAgentPaths().skillsRoot, skillName);
    const skillMd = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMd)) {
      return { ok: false, error: `技能不存在：${skillName}（skill-packages/ 下没有该目录）` };
    }
    if (!query.trim()) {
      return { ok: false, error: "query 不能为空" };
    }

    try {
      if (evalType === "trigger") {
        if (shouldTrigger === undefined) {
          return { ok: false, error: "trigger 用例必须指定 shouldTrigger（true 正例 / false 负例）" };
        }
        const file = path.join(skillDir, TRIGGER_FILE);
        const existing = readJsonOrNull(file);
        const list = Array.isArray(existing) ? existing : [];
        if (list.some((e) => typeof e === "object" && e !== null && (e as { query?: unknown }).query === query)) {
          return { ok: false, error: `该 trigger 用例已存在：${query.slice(0, 40)}` };
        }
        const entry = { query, should_trigger: shouldTrigger, ...(note ? { note } : {}) };
        list.push(entry);
        writeJson(file, list);
        return {
          ok: true,
          evalType: "trigger",
          file: TRIGGER_FILE,
          total: list.length,
          added: entry,
        };
      }

      // functional：写入 evals/evals.json 的 evals 数组（保留 skill_name）
      const file = path.join(skillDir, EVALS_FILE);
      const existing = readJsonOrNull(file);
      const base = (typeof existing === "object" && existing !== null ? existing : {}) as Record<string, unknown>;
      const entries = Array.isArray(base.evals) ? (base.evals as Array<Record<string, unknown>>) : [];
      if (entries.some((e) => e.prompt === query)) {
        return { ok: false, error: `该 functional 用例已存在：${query.slice(0, 40)}` };
      }
      const nextId = entries.reduce((max, e) => Math.max(max, typeof e.id === "number" ? e.id : 0), -1) + 1;
      entries.push({
        id: nextId,
        ...(note ? { name: note } : {}),
        prompt: query,
        ...(expectedOutput ? { expected_output: expectedOutput } : {}),
        files: [],
        expectations: [],
      });
      writeJson(file, { ...base, skill_name: typeof base.skill_name === "string" ? base.skill_name : skillName, evals: entries });
      return {
        ok: true,
        evalType: "functional",
        file: EVALS_FILE,
        total: entries.length,
        added: { id: nextId, prompt: query },
      };
    } catch (error) {
      return { ok: false, error: `写入失败：${error instanceof Error ? error.message : String(error)}` };
    }
  },
});
