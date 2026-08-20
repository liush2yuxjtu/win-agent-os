import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Read CBM and target-stock-day metrics from the current order snapshot.\n\n``bar_code`` is optional. When supplied, target-stock-day output is scoped\nto that SKU so a valid row cannot be lost by the order-level display cap.\nPhysical totals remain order-level totals.",
  inputSchema: z.object({
    shipto_code: z.unknown().describe("必填"),
    ao_in_transit_qty: z.unknown().optional(),
    available_stock_total: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    calc_reason: z.unknown().optional(),
    calculation_context: z.unknown().optional(),
    case_price: z.unknown().optional(),
    confirmed_quantity: z.unknown().optional(),
    constraint_checks: z.unknown().optional(),
    discount: z.unknown().optional(),
    forecast_method: z.unknown().optional(),
    forecast_qty: z.unknown().optional(),
    in_transit_qty: z.unknown().optional(),
    items: z.unknown().optional(),
    max_available_inventory_day: z.unknown().optional(),
    mechanism: z.unknown().optional(),
    ok: z.unknown().optional(),
    pack_count: z.unknown().optional(),
    po_number: z.unknown().optional(),
    quota_capped: z.unknown().optional(),
    remaining_fee: z.unknown().optional(),
    remaining_quota: z.unknown().optional(),
    review_confirmed: z.unknown().optional(),
    review_remark: z.unknown().optional(),
    safety_stock_day: z.unknown().optional(),
    six_day_avg_quantity: z.unknown().optional(),
    sku_name: z.unknown().optional(),
    sku_quantity: z.unknown().optional(),
    target_cbm: z.unknown().optional(),
    target_stock_days: z.unknown().optional(),
    target_stock_ea_derived: z.unknown().optional(),
    target_value: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "query_order_metrics", input as Record<string, unknown>);
  },
});
