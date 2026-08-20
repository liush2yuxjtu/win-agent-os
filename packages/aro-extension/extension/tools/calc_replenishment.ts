import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "运行完整补货管线(会持久化建议订单)。force_recompute=true 时先从销售源重算 ABC+预测。" +
    "传入 po_number 时刷新该延期审核订单,而非生成新订单。写操作,调用前向用户确认。",
  inputSchema: z.object({
    soldto_code: z.string().optional().describe("客户代码(客户作用域下可不填)"),
    shipto_code: z.string().optional().describe("门店代码"),
    bar_code: z.string().optional().describe("只对单个 SKU 生成时传入"),
    force_recompute: z.boolean().optional().describe("是否先从销售重算 ABC+预测,默认 false"),
    po_number: z.string().optional().describe("延期审核订单号;传入则刷新该单而非新建"),
  }),
  async execute(input) {
    return callTool(extension.config, "calc_replenishment", input as Record<string, unknown>);
  },
});
