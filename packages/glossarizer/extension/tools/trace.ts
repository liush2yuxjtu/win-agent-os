import { defineTool } from "eve/tools";
import { z } from "zod";
import { Glossary, GlossaryError } from "../lib/glossary";
import extension from "../extension";

/**
 * 溯源一条业务规则：规则 → 术语定义 → 物理字段 → 标注人/口径。
 * 业务专家看到 Excel 公式时，可以一键追到「这个数是谁标的、来自哪张表哪一列」。
 */
export default defineTool({
  description:
    "溯源一条业务规则：给出规则（如「ROI达标」）→ 引用的每个术语的定义与聚合语义 → 每个术语绑定的物理表/字段 → 标注人、标注时间、口径注释。用于向业务专家证明公式可验证、可追责。",
  inputSchema: z.object({
    rule: z.string().describe("规则名，如 ROI达标"),
  }),
  async execute({ rule }) {
    const { glossaryPath, rulesPath, dialect } = extension.config;
    const g = new Glossary(glossaryPath, rulesPath, dialect);
    try {
      return g.trace(rule);
    } catch (e) {
      if (e instanceof GlossaryError) return { error: e.message };
      throw e;
    }
  },
});
