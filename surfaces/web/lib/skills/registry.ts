/**
 * 技能注册表运行时层（server-only）。
 *
 * 数据流：
 *  - sync 脚本（scripts/sync-skills.mts）扫描 skill-packages/ → 生成 registry.json 快照（提交 git）
 *  - 运行时 getSkillRegistry() 读快照（unstable_cache 缓存；serverless 下无法实时扫文件系统）
 *  - enabled 覆盖层与快照同文件，由 server action（actions.ts）与 sync 脚本共同维护
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { readRegistryFile } from "@agent/lib/skills/registry-file";
import type { SkillRegistry } from "@agent/lib/skills/types";

export { registryPath, readRegistryFile, writeRegistryFile } from "@agent/lib/skills/registry-file";
export const SKILL_REGISTRY_TAG = "skills-registry";

/** 带缓存的注册表读取：15 分钟 + 显式 tag 失效（启停操作后 revalidateTag）。 */
export const getSkillRegistry = unstable_cache(
  async (): Promise<SkillRegistry> => readRegistryFile(),
  ["skills-registry-snapshot"],
  { revalidate: 900, tags: [SKILL_REGISTRY_TAG] },
);

/** 运行时读取技能列表（含 enabled 覆盖）。 */
export async function listSkills(): Promise<SkillRegistry["skills"]> {
  const registry = await getSkillRegistry();
  return registry.skills;
}

/** 动态开局推荐：所有启用且声明了 suggest 的技能，各生成一条推荐气泡。 */
export async function getSkillSuggestions(): Promise<string[]> {
  const registry = await getSkillRegistry();
  return registry.skills
    .filter((skill) => skill.enabled && Boolean(skill.suggest))
    .map((skill) => skill.suggest as string);
}
