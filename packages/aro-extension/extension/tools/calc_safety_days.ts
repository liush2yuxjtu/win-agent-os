import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "计算 ARO SKU 的 COV、K 因子和安全库存天数(COC 方法),只读,不修改安全库存配置或订单。" +
    "解释某个 SKU 为什么是某个安全库存天数时优先用 query_safety_metrics 取已落库结果。",
  inputSchema: z.object({
    shipto_code: z.string().describe("门店代码(必填)"),
    bar_code: z.string().describe("SKU 条码(必填)"),
    soldto_code: z.string().optional().describe("客户代码(客户作用域下可不填)"),
  }),
  async execute(input) {
    return callTool(extension.config, "calc_safety_days", input as Record<string, unknown>);
  },
});
