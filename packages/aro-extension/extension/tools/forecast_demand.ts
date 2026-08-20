import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "查询 ARO SKU 的销量、ABC 档位和 STL 三档需求预测(high/neutral/low),只读不写预测缓存。" +
    "需要从销售源持久重算 ABC、预测并生成订单时,应使用 calc_replenishment(force_recompute=true)。",
  inputSchema: z.object({
    shipto_code: z.string().describe("门店代码(必填)"),
    bar_code: z.string().optional().describe("SKU 条码;不填返回该门店全部 SKU"),
    soldto_code: z.string().optional().describe("客户代码(客户作用域下可不填)"),
    lookback_days: z.number().int().min(90).max(365).optional().describe("回溯天数,默认 180"),
  }),
  async execute(input) {
    return callTool(extension.config, "forecast_demand", input as Record<string, unknown>);
  },
});
