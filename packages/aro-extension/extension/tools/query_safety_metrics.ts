import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "SafetyStockDay (+ optional SkuCalcMetric) for SKU or all rows for soldto.",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    class_by_sku: z.unknown().optional(),
    high: z.unknown().optional(),
    include_calc_metric: z.unknown().optional(),
    limit: z.unknown().optional(),
    low: z.unknown().optional(),
    method: z.unknown().optional(),
    neutral: z.unknown().optional(),
    ok: z.unknown().optional(),
    po_number: z.string().describe("建议订单号(backend 强制画像上下文,必填——先查建议订单获取)"),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "query_safety_metrics", input as Record<string, unknown>);
  },
});
