import { defineTool } from "eve/tools";
import { z } from "zod";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Glossary } from "../lib/glossary";
import { renderWorkbook } from "../lib/excel";
import * as XLSX from "xlsx";
import extension from "../extension";

/**
 * 把当前挂载的语义层（词典+规则）导出为给业务专家看的 Excel 文件：
 *   Sheet1 字段标注（物理字段→权威中文名→释义→标注来源）
 *   Sheet2 业务术语（定义+聚合语义+粒度）
 *   Sheet3 业务规则（表达式+展开后的最终 Excel 公式+负责人）
 * 输出 .xlsx 文件路径，业务专家可直接打开审阅/对齐口径。
 */
export default defineTool({
  description:
    "导出业务口径 Excel 视图：三个 sheet（字段标注/业务术语/业务规则），规则 sheet 含展开后的最终 Excel 公式（如 ROI达标 → IF((SUM(...))/(SUM(...)) > 基线, TRUE, FALSE)）。给业务专家审阅口径用。",
  inputSchema: z.object({
    outputPath: z.string().default("glossary-review.xlsx").describe("输出 .xlsx 路径（相对项目根目录）"),
  }),
  async execute({ outputPath }) {
    const { glossaryPath, rulesPath, dialect } = extension.config;
    const g = new Glossary(glossaryPath, rulesPath, dialect);
    const wb = renderWorkbook(g);
    const abs = resolve(process.cwd(), outputPath);
    writeFileSync(abs, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    return {
      ok: true,
      written: abs,
      sheets: ["字段标注", "业务术语", "业务规则"],
      fields: g.listFields().length,
      terms: g.listTerms().length,
      rules: g.listRules().length,
    };
  },
});
