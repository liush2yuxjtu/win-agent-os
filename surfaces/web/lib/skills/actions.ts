"use server";

import { revalidateTag } from "next/cache";
import { syncToDb } from "@agent/lib/platform/web/skills/db";
import { readRegistryFile, writeRegistryFile } from "@agent/lib/skills/registry-file";
import { SKILL_REGISTRY_TAG } from "./registry";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * 启停技能（runtime disable）：
 * 只翻转 registry.json 的 enabled 标记 —— 技能包固定位于 skill-packages/<name>/，
 * eve 侧由 agent/skills/<name>.ts 的 defineDynamic gate 每轮 turn 读取 registry
 * （见 agent/lib/skills-runtime.ts），下一轮消息立即生效。
 *
 * 无需移动目录、无需重启、无需 eve rebuild。
 */
export async function toggleSkill(name: string, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!NAME_PATTERN.test(name)) return { ok: false, error: "非法技能名" };

  const registry = readRegistryFile();
  const skill = registry.skills.find((s) => s.name === name);
  if (!skill) return { ok: false, error: `技能不存在（${name}）` };
  if (skill.enabled === enabled) return { ok: true, }; // 已是目标状态，幂等

  skill.enabled = enabled;
  writeRegistryFile(registry);
  syncToDb(registry.skills);
  revalidateTag(SKILL_REGISTRY_TAG, "minutes");
  return { ok: true };
}
