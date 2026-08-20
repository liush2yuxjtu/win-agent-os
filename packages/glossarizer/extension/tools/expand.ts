import { defineTool } from "eve/tools";
import { z } from "zod";
import { Glossary, GlossaryError } from "../lib/glossary";
import extension from "../extension";

/**
 * 把业务术语/规则展开成可执行公式（Excel 或 SQL）。
 * 聚合语义在词典里写死（如「本周平均ROI」= SUM(产出)/SUM(消耗)），
 * 展开结果永远是唯一可验证的，不会出现「简单平均 vs 加权平均」歧义。
 */
export default defineTool({
  description:
    "把业务术语或业务规则展开成 Excel 公式或 SQL：如「本周平均ROI」→ =SUM(产出)/SUM(消耗)（excel）或 SUM(...)/NULLIF(SUM(...),0)（sql）；「ROI达标」→ =IF(ROI > 3, TRUE, FALSE)。业务专家和 skill 都基于这个唯一展开，避免口径歧义。",
  inputSchema: z.object({
    name: z.string().describe("术语名或规则名，如 本周平均ROI、ROI达标"),
    target: z.enum(["excel", "sql"]).default("excel").describe("展开目标：Excel 公式或 SQL 表达式"),
  }),
  async execute({ name, target }) {
    const { glossaryPath, rulesPath, dialect } = extension.config;
    const g = new Glossary(glossaryPath, rulesPath, dialect);
    try {
      return { name, target, expanded: g.expand(name, target), dialect };
    } catch (e) {
      if (e instanceof GlossaryError) return { error: e.message };
      throw e;
    }
  },
});
