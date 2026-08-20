import { defineTool } from "eve/tools";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GlossaryConfig } from "../lib/glossary";
import { importDocs } from "../lib/import-docs";
import extension from "../extension";

/**
 * 从权威字段标注文档（内容管理平台数据库表字段释义文档）导入 tables/fields。
 * 标注人 = 文档来源，术语 = 权威中文名；合并写入当前挂载的 glossaryPath。
 */
export default defineTool({
  description:
    "从权威字段标注文档目录导入表与字段绑定：扫描目录下所有字段释义 md，解析表元数据与字段中文名/释义，合并写入当前挂载的术语词典（幂等，同表同列覆盖）。标注人记录为文档来源而非个人。导入后用 validate 校验。",
  inputSchema: z.object({
    docsDir: z.string().describe("权威标注文档目录（如 video-managmenet-chat/内容管理平台数据库表字段释义文档-26-07-21）"),
    dryRun: z.boolean().default(true).describe("true 只预览不写入"),
  }),
  async execute({ docsDir, dryRun }) {
    const { glossaryPath } = extension.config;
    const result = importDocs(docsDir);

    if (dryRun) {
      return {
        dryRun: true,
        docs: result.docCount,
        tables: result.tables.map((t) => t.name),
        fields: result.fieldCount,
        sample: result.fields.slice(0, 5).map((f) => `${f.table}.${f.column} → ${f.term}`),
      };
    }

    // 合并写入 glossaryPath
    const abs = resolve(process.cwd(), glossaryPath);
    const cfg = JSON.parse(readFileSync(abs, "utf8")) as GlossaryConfig;
    cfg.tables = result.tables;
    cfg.fields = result.fields;
    writeFileSync(abs, JSON.stringify(cfg, null, 2) + "\n");

    return {
      ok: true,
      written: abs,
      docs: result.docCount,
      tables: result.tables.length,
      fields: result.fieldCount,
    };
  },
});
