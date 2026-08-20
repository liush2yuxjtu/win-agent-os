import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { syncToDb } from "../lib/platform/web/skills/db";
import { scanSkillsDir } from "../lib/skills/scan";
import { readRegistryFile, writeRegistryFile } from "../lib/skills/registry-file";
import { validateSkillReferences } from "../lib/skills/validate";
import { getAgentPaths } from "../platform";

/**
 * 技能上架工具：把模型（或用户）编写的 SKILL.md 发布到 agent/skills/，
 * 并立即同步注册表快照（lib/skills/registry.json），无需开发者跑命令。
 *
 * 边界：
 *  - 只允许写入 agent/skills/<name>/SKILL.md（name 白名单，防路径穿越）
 *  - frontmatter description 必填（eve 约定）
 *  - 发布后对正文做 qc 表引用校验（对照 qc-mcp-server 字典），提示未知表
 *  - 开发模式（eve dev watcher）自动 rebuild 生效；生产模式需重新 build:eve
 */

/** 技能包内容根（runtime disable 后 eve 不直接扫描这里，由 gate 动态暴露）。 */
const skillsRoot = () => getAgentPaths().skillsRoot;
/** gate 文件根：agent/skills/<name>.ts（defineDynamic，见 agent/lib/skills-runtime.ts）。 */
const gateRoot = () => getAgentPaths().gateRoot;
const GATE_TEMPLATE = (name: string): string => `/**
 * 动态技能 gate（runtime disable 机制，见 agent/lib/skills-runtime.ts）：
 * 定义来自 skill-packages/${name}/，enabled 由 lib/skills/registry.json 控制。
 * turn.started 每轮重解析 → UI toggle 后下一条消息立即生效。
 */
import { defineDynamic } from "eve/skills";
import { gatedSkill } from "../lib/skills-runtime";

export default defineDynamic({
  events: {
    "turn.started": () => gatedSkill("${name}"),
  },
});
`;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export default defineTool({
  description:
    "发布（上架）一个新技能：接收完整的 SKILL.md 内容（含 frontmatter），写入 skill-packages/<name>/SKILL.md 并生成 eve 动态 gate（agent/skills/<name>.ts），校验 frontmatter 与 qc 表引用，并同步注册表快照，让技能立即出现在技能管理页。创建技能时应先遵循 authoring-skills / skill-creator 的方法论编写 SKILL.md，再调用本工具发布。",
  inputSchema: z.object({
    name: z
      .string()
      .regex(NAME_PATTERN, "技能名仅允许小写字母、数字与连字符，长度 2-64")
      .describe("技能名（目录名），如 ai-control"),
    skillMd: z.string().min(10).describe("完整 SKILL.md 内容：必须包含 --- frontmatter（description 必填）与正文"),
    summary: z.string().max(500).optional().describe("可选：一句话说明本次发布内容（写入返回值，便于核对）"),
  }),
  async execute({ name, skillMd, summary }) {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. frontmatter 校验
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(skillMd);
    } catch (error) {
      return { ok: false, error: `frontmatter 解析失败：${error instanceof Error ? error.message : String(error)}` };
    }
    const description = typeof parsed.data.description === "string" ? parsed.data.description : "";
    if (!description) {
      return { ok: false, error: "SKILL.md 必须包含 description frontmatter（eve 要求）" };
    }

    // 2. 写盘（防路径穿越：name 已白名单化）
    const targetDir = path.join(skillsRoot(), name);
    const targetFile = path.join(targetDir, "SKILL.md");
    if (!targetDir.startsWith(skillsRoot())) {
      return { ok: false, error: "非法技能名" };
    }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetFile, skillMd, "utf8");

    // 2.5 生成 eve 动态 gate（agent/skills/<name>.ts）——eve 通过它按 registry enabled 暴露技能
    const gateFile = path.join(gateRoot(), `${name}.ts`);
    fs.writeFileSync(gateFile, GATE_TEMPLATE(name), "utf8");

    // 3. 重新扫描并写注册表（enabled 保留上一版覆盖：新技能默认启用）
    const { skills, audit } = scanSkillsDir(skillsRoot());
    const previous = readRegistryFile();
    const enabledByName = new Map(previous.skills.map((s) => [s.name, s.enabled]));
    for (const skill of skills) {
      const prev = enabledByName.get(skill.name);
      if (prev !== undefined) skill.enabled = prev;
    }
    const registry = {
      version: 1 as const,
      generatedAt: new Date().toISOString(),
      skills,
      audit: { ...audit, warnings: [...audit.warnings] },
      sync: previous.sync,
    };
    registry.audit.status = registry.audit.warnings.length > 0 ? "warning" : "passed";
    syncToDb(registry.skills);
    writeRegistryFile(registry);

    // 4. qc 表引用校验（可选提示）
    const { unavailable, error: dictError, issues } = await validateSkillReferences(name, skillMd);
    if (unavailable) {
      warnings.push(`qc 表引用校验不可用：${dictError}`);
    } else if (issues.length > 0) {
      for (const issue of issues) {
        warnings.push(`引用的表「${issue.table}」不在 38 张表字典中`);
      }
    }

    const published = skills.find((s) => s.name === name);
    if (!published) {
      return { ok: false, error: `技能已写入但扫描未发现（目录：${name}）` };
    }

    return {
      ok: true,
      name,
      description,
      folder: published.folder,
      files: published.files.length,
      registrySkills: skills.length,
      summary: summary ?? `已发布技能 ${name}`,
      warnings,
      notes: [
        "开发模式（eve dev）会自动重建并生效；生产部署需重新构建（npm run build:eve）。",
        "技能管理页可立即看到该技能（15 分钟内缓存）。",
      ],
    };
  },
});
