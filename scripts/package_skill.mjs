#!/usr/bin/env node
/**
 * package_skill.mjs — 把 eve 技能目录打包成单文件 .skill（zip 格式）。
 *
 * eve 技能目录结构：skill-packages/<name>/SKILL.md（必含 name/description frontmatter），
 * 可含 evals/、references/、scripts/ 等子目录。本脚本把整个技能目录压成 zip，
 * zip 根即技能目录名（解压后得到 <name>/SKILL.md、<name>/evals/...），
 * 输出到 dist/skills/<name>.skill，作为可分发交付物。
 *
 * 用法：
 *   node scripts/package_skill.mjs                     # 列出全部技能名 + 用法
 *   node scripts/package_skill.mjs <skillName>         # 输出到 dist/skills/
 *   node scripts/package_skill.mjs <skillName> <dir>   # 指定输出目录
 *
 * 依赖：系统 /usr/bin/zip（macOS 自带），无 npm 依赖，不参与 tsc。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SKILLS_DIR = join(ROOT, "agent", "skills");
const ZIP = "/usr/bin/zip";
const DEFAULT_OUT_DIR = join(ROOT, "dist", "skills");

/** 列出 skill-packages/ 下含 SKILL.md 的技能目录名。 */
function listSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((entry) => statSync(join(SKILLS_DIR, entry)).isDirectory())
    .filter((entry) => existsSync(join(SKILLS_DIR, entry, "SKILL.md")))
    .sort();
}

/** 用正则解析 frontmatter，返回 { name, description }（缺失时为 undefined）。 */
function parseFrontmatter(content) {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return {};
  const body = block[1];
  const field = (key) => body.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
  return { name: field("name"), description: field("description") };
}

function usage(skills) {
  console.log("用法: node scripts/package_skill.mjs <skillName> [输出目录, 默认 dist/skills]");
  console.log("");
  console.log("可用技能:");
  for (const name of skills) console.log(`  ${name}`);
  console.log("");
  console.log("示例: node scripts/package_skill.mjs ai-control");
}

function main() {
  const [skillName, outDirArg] = process.argv.slice(2);
  const skills = listSkills();

  if (!skillName) {
    usage(skills);
    process.exit(0);
  }

  const skillDir = join(SKILLS_DIR, skillName);
  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) {
    console.error(`错误: skill-packages/ 下没有技能 "${skillName}"`);
    usage(skills);
    process.exit(1);
  }

  const skillMdPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    console.error(`错误: ${skillDir} 缺少 SKILL.md，不是合法的 eve 技能目录`);
    process.exit(1);
  }

  const fm = parseFrontmatter(readFileSync(skillMdPath, "utf8"));
  if (!fm.name || !fm.description) {
    console.error(`错误: ${skillMdPath} 的 frontmatter 缺少 name 或 description`);
    process.exit(1);
  }

  const outDir = resolve(outDirArg ?? DEFAULT_OUT_DIR);
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${skillName}.skill`);

  // zip -r 对已存在的归档是更新语义，旧文件可能残留；先删掉保证产物干净。
  if (existsSync(outFile)) rmSync(outFile);

  // 以技能目录名为 zip 根（cwd 切到 skill-packages，zip ai-control 即得 ai-control/... 前缀）
  execFileSync(ZIP, ["-r", "-q", outFile, skillName], { cwd: SKILLS_DIR, stdio: "inherit" });

  if (!existsSync(outFile)) {
    console.error("错误: zip 打包失败，未生成产物");
    process.exit(1);
  }

  const size = statSync(outFile).size;
  const contents = execFileSync(ZIP, ["-sf", outFile], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.trim().length > 0);

  console.log(`已打包: ${outFile} (${size} bytes)`);
  console.log("内含文件:");
  for (const line of contents) console.log(`  ${line}`);
}

main();
