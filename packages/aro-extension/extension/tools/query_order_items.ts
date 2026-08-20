import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "查询建议订单的订单项明细(数量/金额/箱数/缺量),支持按 po_number 或门店+SKU 过滤。" +
    "订单审核、订单量核对、缺货分析时使用。",
  inputSchema: z.object({
    po_number: z.string().optional().describe("订单号;传入则只查该单明细"),
    soldto_code: z.string().optional().describe("客户代码(客户作用域下可不填)"),
    shipto_code: z.string().optional().describe("门店代码"),
    bar_code: z.string().optional().describe("SKU 条码过滤"),
    order_profile_id: z.number().int().optional().describe("订单画像 ID"),
  }),
  async execute(input) {
    return callTool(extension.config, "query_order_items", input as Record<string, unknown>);
  },
});
