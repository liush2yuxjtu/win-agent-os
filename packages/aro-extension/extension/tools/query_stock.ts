import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "查询 ARO 单个 SKU 的实时库存快照(来自 Org/Warehouse 来源的 base_stock)。" +
    "配合 calc_safety_days / forecast_demand 解释库存与安全库存差异。",
  inputSchema: z.object({
    soldto_code: z.string().optional().describe("客户代码(客户作用域下可不填)"),
    shipto_code: z.string().describe("门店代码(必填)"),
    bar_code: z.string().describe("SKU 条码(必填)"),
  }),
  async execute(input) {
    return callTool(extension.config, "query_stock", input as Record<string, unknown>);
  },
});
