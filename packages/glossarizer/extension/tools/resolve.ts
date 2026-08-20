import { defineTool } from "eve/tools";
import { z } from "zod";
import { Glossary, GlossaryError } from "../lib/glossary";
import extension from "../extension";

/**
 * 查业务术语：返回定义、聚合语义、以及它绑定到的物理字段（含标注人/口径注释）。
 * 任何 skill 想用业务口径（ROI、产出、消耗……）都应先查这里，而不是自己定义。
 */
export default defineTool({
  description:
    "查询业务术语词典：给一个业务术语名（如「ROI」「产出」「消耗」「本周平均ROI」），返回其定义公式、聚合语义、粒度，以及绑定到的物理表/字段、标注人、口径注释。业务分析前先用它确认口径。",
  inputSchema: z.object({
    term: z.string().describe("业务术语名，如 ROI、产出、消耗、本周平均ROI"),
  }),
  async execute({ term }) {
    const { glossaryPath, rulesPath, dialect } = extension.config;
    const g = new Glossary(glossaryPath, rulesPath, dialect);
    try {
      const resolved = g.resolve(term);
      return {
        term: resolved.name,
        definition: resolved.definition,
        aggregation: resolved.aggregation,
        grain: resolved.grain,
        version: resolved.version,
        sources: resolved.sources,
      };
    } catch (e) {
      if (e instanceof GlossaryError) return { error: e.message };
      throw e;
    }
  },
});
