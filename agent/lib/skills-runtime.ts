/**
 * 技能运行时 gate：把 skill-packages/ 里的技能包按 registry.json 的
 * enabled 状态动态暴露给 eve（defineDynamic 机制，见 agent/skills/*.ts）。
 *
 * 为什么需要：eve 的 discover 是构建时文件系统扫描，无 enabled 概念。
 * 旧方案 toggle = 物理移动目录（agent/skills ↔ agent/.skills-disabled）+
 * eve rebuild，不是真正的 runtime disable。本模块让 toggle 只改 registry.json，
 * gate 在每轮 turn 解析时读取，下一轮消息立即生效 —— 无需移动目录、无需重启。
 *
 * 返回 null = eve 不暴露该技能：不出现在 Available skills 里，
 * load_skill 也找不到（静态列表为空，见 agent/skills/ 只剩 gate 文件）。
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { defineSkill } from "eve/skills";
import { getAgentPaths } from "../platform";

const registryPath = () => getAgentPaths().registrySnapshotPath;
const packagesRoot = () => getAgentPaths().skillsRoot;

/** 缓存签名：registry mtime + 包内文件最大 mtime，任一变化即失效。 */
function signatureOf(name: string, dir: string): string {
  const parts: string[] = [];
  try {
    parts.push(String(fs.statSync(registryPath()).mtimeMs));
  } catch {
    parts.push("no-registry");
  }
  let latest = 0;
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      const mtime = fs.statSync(full).mtimeMs;
      if (mtime > latest) latest = mtime;
      if (entry.isDirectory()) walk(full);
    }
  };
  try {
    walk(dir);
  } catch {
    /* 包缺失时签名保持稳定 */
  }
  parts.push(String(latest));
  return parts.join("|");
}

const cache = new Map<string, { sig: string; value: ReturnType<typeof defineSkill> | null }>();

/** registry.json 里的记录：enabled 缺省视为启用（旧快照兼容）。 */
function isEnabled(name: string): boolean {
  try {
    const registry = JSON.parse(fs.readFileSync(registryPath(), "utf8")) as {
      skills?: Array<{ name?: string; enabled?: boolean }>;
    };
    const rec = (registry.skills ?? []).find((s) => s.name === name);
    return rec ? rec.enabled !== false : true;
  } catch {
    return true; // registry 不可读时放行（不误伤已启用技能）
  }
}

/** 收集包内 SKILL.md 之外的文本文件（references/assets/scripts…）。 */
function collectPackageFiles(dir: string, base: string, files: Record<string, string>): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPackageFiles(full, base, files);
    } else if (entry.name !== "SKILL.md" && entry.name !== "skill.md") {
      files[path.relative(base, full).replace(/\\/g, "/")] = fs.readFileSync(full, "utf8");
    }
  }
}

/**
 * 返回技能 name 的 defineSkill 定义；registry 标记 disabled 或包缺失/解析失败时
 * 返回 null（eve 不暴露该技能）。结果按（registry mtime + 包文件 mtime）缓存，
 * turn 内重复解析零开销。
 */
export function gatedSkill(name: string): ReturnType<typeof defineSkill> | null {
  const dir = path.join(packagesRoot(), name);
  const sig = signatureOf(name, dir);
  const hit = cache.get(name);
  if (hit && hit.sig === sig) return hit.value;

  let value: ReturnType<typeof defineSkill> | null = null;
  if (isEnabled(name)) {
    const skillMd = path.join(dir, "SKILL.md");
    if (fs.existsSync(skillMd)) {
      try {
        const parsed = matter(fs.readFileSync(skillMd, "utf8"));
        const description = typeof parsed.data.description === "string" ? parsed.data.description : "";
        if (description) {
          const files: Record<string, string> = {};
          collectPackageFiles(dir, dir, files);
          let metadata: Record<string, string> | undefined;
          if (parsed.data.metadata && typeof parsed.data.metadata === "object") {
            metadata = {};
            for (const [k, v] of Object.entries(parsed.data.metadata)) {
              if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") metadata[k] = String(v);
            }
            if (Object.keys(metadata).length === 0) metadata = undefined;
          }
          value = defineSkill({
            description,
            markdown: parsed.content,
            files,
            ...(typeof parsed.data.license === "string" ? { license: parsed.data.license } : {}),
            ...(metadata ? { metadata } : {}),
          });
        }
      } catch {
        value = null; // 解析失败按缺失处理，不暴露
      }
    }
  }
  cache.set(name, { sig, value });
  return value;
}
