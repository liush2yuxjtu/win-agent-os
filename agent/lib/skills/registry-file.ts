/**
 * 注册表快照的纯文件读写（无 server-only 依赖，CLI 与 server 共用）。
 */
import fs from "node:fs";
import path from "node:path";
import { getAgentPaths } from "../../platform";
import type { SkillRegistry } from "./types";

/** 快照路径：lib/skills/registry.json（与代码一起提交）。 */
export function registryPath(): string {
  return getAgentPaths().registrySnapshotPath;
}

export function readRegistryFile(): SkillRegistry {
  const file = registryPath();
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      generatedAt: "",
      skills: [],
      audit: {
        status: "warning",
        checks: [{ label: "注册表快照存在", passed: false, detail: `${file} 缺失，请运行 npm run skills:sync` }],
        warnings: ["注册表快照缺失"],
      },
    };
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as SkillRegistry;
}

/** 原子写快照（临时文件 + rename，避免并发写坏）。 */
export function writeRegistryFile(next: SkillRegistry): void {
  const file = registryPath();
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}
