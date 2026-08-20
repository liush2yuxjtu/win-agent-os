import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Return complete read-only aggregates for the order under review.",
  inputSchema: z.object({
    shipto_code: z.unknown().describe("必填"),
    abc_class: z.unknown().optional(),
    abc_mismatch_note: z.unknown().optional(),
    abc_source: z.unknown().optional(),
    active: z.unknown().optional(),
    akbd: z.unknown().optional(),
    akbd_capped: z.unknown().optional(),
    ao_in_transit_qty: z.unknown().optional(),
    available_stock_total: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    calc_reason: z.unknown().optional(),
    case_price: z.unknown().optional(),
    confirmed_quantity: z.unknown().optional(),
    constraint_checks: z.unknown().optional(),
    discount: z.unknown().optional(),
    forecast_method: z.unknown().optional(),
    forecast_qty: z.unknown().optional(),
    in_transit_qty: z.unknown().optional(),
    items: z.unknown().optional(),
    max_quantity: z.unknown().optional(),
    mechanism: z.unknown().optional(),
    ok: z.unknown().optional(),
    order_fee: z.unknown().optional(),
    order_total: z.unknown().optional(),
    pack_count: z.unknown().optional(),
    plan_fee: z.unknown().optional(),
    po_item_type: z.unknown().optional(),
    po_number: z.unknown().optional(),
    positive_sku_count: z.unknown().optional(),
    quota: z.unknown().optional(),
    quota_capped: z.unknown().optional(),
    quota_end_date: z.unknown().optional(),
    quota_start_date: z.unknown().optional(),
    remaining_fee: z.unknown().optional(),
    remaining_quota: z.unknown().optional(),
    review_confirmed: z.unknown().optional(),
    review_remark: z.unknown().optional(),
    safety_stock_day: z.unknown().optional(),
    six_day_avg_quantity: z.unknown().optional(),
    sku_name: z.unknown().optional(),
    sku_quantity: z.unknown().optional(),
    status: z.unknown().optional(),
    total_amount: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "query_order_analysis", input as Record<string, unknown>);
  },
});
