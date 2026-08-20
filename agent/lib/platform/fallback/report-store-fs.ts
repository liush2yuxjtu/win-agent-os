/**
 * standalone/headless 的报告库降级实现（fs/JSON）。
 *
 * 文件布局：
 *   <reportsDir>/*.html                        报告本体（路径来自 getAgentPaths().reportsDir）
 *   <reportsDir>/../reports-index.json         报告元数据索引（与 reportsDir 同父目录）
 *
 * 原则：文件不存在时返回空列表/null，绝不抛错。
 */
import fs from "node:fs";
import path from "node:path";
import { getAgentPaths } from "../../../platform";
import type { ReportMetaLite, ReportStore } from "../../../platform";

function reportsDir(): string {
  return getAgentPaths().reportsDir;
}

function indexPath(): string {
  return path.join(path.dirname(reportsDir()), "reports-index.json");
}

function readIndex(): ReportMetaLite[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(indexPath(), "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ReportMetaLite =>
        typeof e === "object" && e !== null && typeof (e as ReportMetaLite).id === "string",
    );
  } catch {
    return [];
  }
}

function writeIndex(reports: ReportMetaLite[]): void {
  try {
    fs.mkdirSync(path.dirname(indexPath()), { recursive: true });
    fs.writeFileSync(indexPath(), JSON.stringify(reports, null, 2) + "\n", "utf8");
  } catch {
    // 降级实现：写失败不抛错
  }
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(0, 4096));
  const title = match?.[1]?.trim();
  return title || null;
}

export const ReportStoreFs: ReportStore = {
  reportsDbPath(): string {
    return path.join(getAgentPaths().repoRoot, ".eve", "artifacts", "reports.db");
  },

  openReportsDb(): null {
    return null;
  },

  isDynamicReport(html: string): boolean {
    return html.includes("window.REPORT_SOURCES") || html.includes("REPORT_SOURCES");
  },

  registerReport(name: string, html: string): ReportMetaLite {
    const id = name.replace(/\.html$/i, "");
    const now = new Date().toISOString();
    const meta: ReportMetaLite = {
      id,
      name,
      path: `/reports/${name}`,
      title: extractTitle(html) ?? id,
      sizeBytes: Buffer.byteLength(html, "utf8"),
      dynamic: this.isDynamicReport(html),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    try {
      fs.mkdirSync(reportsDir(), { recursive: true });
      fs.writeFileSync(path.join(reportsDir(), name), html, "utf8");
      const all = readIndex().filter((r) => r.id !== id);
      all.unshift(meta);
      writeIndex(all);
    } catch {
      // 写失败不抛错
    }
    return meta;
  },

  archiveReport(id: string, archived: boolean): void {
    const all = readIndex().map((r) => (r.id === id ? { ...r, archived } : r));
    writeIndex(all);
  },

  listReports(): ReportMetaLite[] {
    return readIndex();
  },

  getReport(id: string): ReportMetaLite | null {
    return readIndex().find((r) => r.id === id) ?? null;
  },

  deleteReport(id: string): void {
    try {
      const report = readIndex().find((r) => r.id === id);
      if (report) fs.rmSync(path.join(reportsDir(), report.name), { force: true });
    } catch {
      // ignore
    }
    writeIndex(readIndex().filter((r) => r.id !== id));
  },

  countReports(): number {
    return readIndex().length;
  },

  scanReportsDir(): number {
    let added = 0;
    try {
      for (const entry of fs.readdirSync(reportsDir())) {
        if (!entry.endsWith(".html")) continue;
        try {
          const html = fs.readFileSync(path.join(reportsDir(), entry), "utf8");
          const id = entry.replace(/\.html$/i, "");
          if (!readIndex().some((r) => r.id === id)) {
            this.registerReport(entry, html);
            added += 1;
          }
        } catch {
          // 单个文件失败跳过
        }
      }
    } catch {
      // 目录不存在返回 0
    }
    return added;
  },
};
