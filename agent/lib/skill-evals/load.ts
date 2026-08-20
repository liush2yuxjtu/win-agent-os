/**
 * 技能包读取：从 skill-packages/<name>/ 读 SKILL.md（frontmatter + 正文）与 evals.json。
 */
import fs from "node:fs";
import path from "node:path";
import { getAgentPaths } from "../../platform";
import matter from "gray-matter";
import type { SkillEvalsFile } from "./types";

export interface LoadedSkill {
  name: string;
  description: string;
  /** SKILL.md 全文（frontmatter + 正文），供 functional eval 作指令。 */
  body: string;
  evals?: SkillEvalsFile;
}

export function loadSkill(name: string): LoadedSkill {
  const skillMd = path.join(getAgentPaths().skillsRoot, name, "SKILL.md");
  if (!fs.existsSync(skillMd)) throw new Error(`技能不存在：${name}`);
  const raw = fs.readFileSync(skillMd, "utf8");
  const parsed = matter(raw);
  const description = typeof parsed.data.description === "string" ? parsed.data.description : "";
  if (!description) throw new Error(`技能 ${name} 缺 description frontmatter`);

  // 用例双文件约定（与 skill-creator / onepager 一致）：
  //  - evals/evals.json        → functional 用例（skill-creator 格式：{ skill_name, evals: [{ id, name, prompt, expected_output, expectations }] }，
  //                              兼容旧 { functional: [...] } 顶层字段）
  //  - evals/trigger-evals.json → trigger 用例（skill-creator/onepager 格式：数组 [{ query, should_trigger }]，
  //                              兼容旧 evals.json 的 trigger 字段）
  let evals: SkillEvalsFile | undefined;
  const evalsPath = path.join(getAgentPaths().skillsRoot, name, "evals", "evals.json");
  const triggerPath = path.join(getAgentPaths().skillsRoot, name, "evals", "trigger-evals.json");
  if (fs.existsSync(evalsPath)) {
    try {
      const rawEvals = JSON.parse(fs.readFileSync(evalsPath, "utf8")) as Record<string, unknown>;
      const legacy = rawEvals as { functional?: SkillEvalsFile["functional"]; trigger?: SkillEvalsFile["trigger"] };
      const entries = Array.isArray(rawEvals.evals) ? (rawEvals.evals as Array<Record<string, unknown>>) : [];
      const functional =
        legacy.functional ??
        entries
          .filter((e) => typeof e.prompt === "string")
          .map((e) => ({
            input: e.prompt as string,
            expected: typeof e.expected_output === "string" ? (e.expected_output as string) : undefined,
            note: typeof e.name === "string" ? (e.name as string) : undefined,
          }));
      evals = { ...(functional ? { functional } : {}), ...(legacy.trigger ? { trigger: legacy.trigger } : {}) };
    } catch (error) {
      console.warn(`[skill-evals] ${name}/evals/evals.json 解析失败:`, error instanceof Error ? error.message : String(error));
    }
  }
  if (fs.existsSync(triggerPath)) {
    try {
      const rawTrigger = JSON.parse(fs.readFileSync(triggerPath, "utf8")) as unknown;
      // onepager/skill-creator 格式：数组 [{ query, should_trigger }]（也接受 { trigger: [...] } 包装）
      const list = Array.isArray(rawTrigger)
        ? rawTrigger
        : Array.isArray((rawTrigger as { trigger?: unknown }).trigger)
          ? ((rawTrigger as { trigger: unknown[] }).trigger)
          : [];
      const trigger = list
        .filter((e): e is { query: string; should_trigger?: boolean } => typeof e === "object" && e !== null && typeof (e as { query?: unknown }).query === "string")
        .map((e) => ({
          prompt: e.query,
          expectedTrigger: e.should_trigger === true,
          note: undefined,
        }));
      if (trigger.length > 0) evals = { ...(evals ?? {}), trigger };
    } catch (error) {
      console.warn(`[skill-evals] ${name}/evals/trigger-evals.json 解析失败:`, error instanceof Error ? error.message : String(error));
    }
  }

  return { name, description, body: raw, evals };
}
