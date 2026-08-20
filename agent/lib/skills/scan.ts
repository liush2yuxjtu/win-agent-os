/**
 * skill-packages/ 扫描器：纯 Node，无 Next.js 依赖，供 CLI 与 server 共用。
 *
 * 规则（对齐 eve 的 skills 约定）：
 *  - packaged：<name>/SKILL.md（description 必填，name 取目录名）
 *  - flat：<name>.md（description 缺省时取正文首行 fallback）
 *  - module：<name>.ts（defineSkill，正文文件系统不可读，标注 kind 即可）
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { RegistryAudit, SkillRecord } from "./types";

const SKILL_MD = "SKILL.md";

export interface ScanResult {
  skills: SkillRecord[];
  audit: RegistryAudit;
}

function fallbackDescription(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("```") || trimmed.startsWith("#")) continue;
    return trimmed.replace(/^[*>-]\s+/, "").slice(0, 240);
  }
  return "";
}

function parseFrontmatter(filePath: string): { data: Record<string, unknown>; content: string } {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  return { data: parsed.data, content: parsed.content };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function listFilesRecursive(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else {
      out.push(path.relative(base, full).replace(/\\/g, "/"));
    }
  }
  return out.sort();
}

/** 扫描单个技能根目录，enabled 由调用方给定（active 根 true，disabled 根 false）。 */
function scanOneRoot(root: string, baseFolder: string, enabled: boolean, skills: SkillRecord[], warnings: string[]): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      const skillMd = path.join(full, SKILL_MD);
      if (!fs.existsSync(skillMd)) continue; // 非技能目录

      const parsed = parseFrontmatter(skillMd);
      const description = asString(parsed.data.description);
      if (!description) {
        warnings.push(`packaged 技能 ${entry.name} 缺 description frontmatter（eve 要求必填）`);
        continue;
      }
      const metadataRaw = parsed.data.metadata;
      const metadata: Record<string, string> = {};
      if (metadataRaw && typeof metadataRaw === "object") {
        for (const [k, v] of Object.entries(metadataRaw)) {
          if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") metadata[k] = String(v);
        }
      }
      const mtime = fs.statSync(skillMd).mtime.toISOString();
      skills.push({
        name: entry.name,
        folder: `${baseFolder}/${entry.name}`,
        kind: "packaged",
        description,
        license: asString(parsed.data.license),
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        suggest: asString(parsed.data.suggest),
        files: listFilesRecursive(full, root),
        mtime,
        enabled,
      });
    } else if (entry.name.endsWith(".md")) {
      const name = entry.name.slice(0, -3);
      const parsed = parseFrontmatter(full);
      const description = asString(parsed.data.description) ?? fallbackDescription(parsed.content);
      skills.push({
        name,
        folder: `${baseFolder}/${entry.name}`,
        kind: "flat",
        description,
        license: asString(parsed.data.license),
        files: [entry.name],
        mtime: fs.statSync(full).mtime.toISOString(),
        enabled,
      });
    } else if (entry.name.endsWith(".ts")) {
      const name = entry.name.slice(0, -3);
      skills.push({
        name,
        folder: `${baseFolder}/${entry.name}`,
        kind: "module",
        description: `模块定义技能（defineSkill）：正文需执行模块获取，文件系统不可读。`,
        files: [entry.name],
        mtime: fs.statSync(full).mtime.toISOString(),
        enabled,
      });
    }
  }
}

/**
 * 扫描技能包目录（skill-packages/，全部技能统一存放；启停状态由
 * registry.json 的 enabled 标记控制，不再依赖目录位置）。
 * @param skillsRoot 技能包根（skill-packages）
 */
export function scanSkillsDir(skillsRoot: string): ScanResult {
  const skills: SkillRecord[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(skillsRoot)) {
    return {
      skills: [],
      audit: {
        status: "warning",
        checks: [{ label: "技能目录存在", passed: false, detail: `${skillsRoot} 不存在` }],
        warnings: ["技能目录缺失"],
      },
    };
  }

  scanOneRoot(skillsRoot, "skill-packages", true, skills, warnings);
  skills.sort((a, b) => a.name.localeCompare(b.name));

  const checks: RegistryAudit["checks"] = [
    { label: "技能目录扫描", passed: skills.length > 0, detail: `${skills.length} 个技能已发现` },
    {
      label: "frontmatter 完整性",
      passed: warnings.length === 0,
      detail: warnings.length === 0 ? "全部技能 frontmatter 合法" : `${warnings.length} 条警告`,
    },
    {
      label: "包内文件完整",
      passed: skills.every((s) => s.files.length > 0),
      detail: "所有技能至少包含一个文件",
    },
  ];

  return {
    skills,
    audit: {
      status: warnings.length > 0 ? "warning" : "passed",
      checks,
      warnings,
    },
  };
}
