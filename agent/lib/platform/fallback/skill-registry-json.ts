/**
 * standalone/headless 的技能注册表降级实现（直接读写 registry.json 快照）。
 *
 * 与 web 的 SQLite 实现（agent/lib/platform/web/skills/db.ts）同接口
 * （见 agent/platform.ts 的 SkillRegistryStore）。非 web profile 不建 SQLite，
 * syncToDb/readFromDb 直接映射到 lib/skills/registry.json。
 */
import fs from "node:fs";
import path from "node:path";
import { getAgentPaths } from "../../../platform";
import type { SkillRegistry, SkillRecord } from "../../skills/types";
import type { SkillRegistryStore } from "../../../platform";

export const SkillRegistryStoreJson: SkillRegistryStore = {
  dbPath(): string {
    return path.join(getAgentPaths().repoRoot, ".eve", "artifacts", "skill-registry.json");
  },

  openDb(): null {
    return null;
  },

  syncToDb(skills: SkillRecord[]): number {
    return skills.length;
  },

  readFromDb(): SkillRecord[] {
    return this.readRegistryFile().skills;
  },

  persistRegistry(registry: SkillRegistry): SkillRegistry {
    this.writeRegistryFile(registry);
    return registry;
  },

  registryPath(): string {
    return getAgentPaths().registrySnapshotPath;
  },

  readRegistryFile(): SkillRegistry {
    const file = this.registryPath();
    if (!fs.existsSync(file)) {
      return {
        version: 1,
        generatedAt: "",
        skills: [],
        audit: {
          status: "warning",
          checks: [{ label: "注册表快照存在", passed: false, detail: `${file} 缺失` }],
          warnings: ["注册表快照缺失"],
        },
      };
    }
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as SkillRegistry;
    } catch {
      return {
        version: 1,
        generatedAt: "",
        skills: [],
        audit: {
          status: "warning",
          checks: [{ label: "注册表快照可解析", passed: false, detail: `${file} 解析失败` }],
          warnings: ["注册表快照解析失败"],
        },
      };
    }
  },

  writeRegistryFile(next: SkillRegistry): void {
    try {
      const file = this.registryPath();
      const tmp = `${file}.tmp`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
      fs.renameSync(tmp, file);
    } catch {
      // 降级实现：写失败不抛错
    }
  },
};
