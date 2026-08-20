import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Add or remove an anomaly filter for a specific store (× optional date) × bar_code.\n\nRequired: shipto_code or soldto_code, store_code OR store_name.\nOptional:\n  bar_code (str) — if omitted or \"*\", filter ALL SKUs for this store (大批发门店整店过滤)\n  sales_date (str) — if omitted, filter ALL dates for this store",
  inputSchema: z.object({
    reason: z.unknown().describe("必填"),
    sales_date: z.unknown().describe("必填"),
    _order_profile_id: z.unknown().optional(),
    action: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    candidates: z.unknown().optional(),
    needs_confirmation: z.unknown().optional(),
    ok: z.unknown().optional(),
    po_number: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
    store_code: z.unknown().optional(),
    store_name: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "mark_anomaly_order", input as Record<string, unknown>);
  },
});
