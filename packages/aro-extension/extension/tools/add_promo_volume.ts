import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Add/list/cancel promo volume additions for SKU(s) on a specific dispatch date.\n\nParams:\n    soldto_code, shipto_code (required),\n    bar_code (str or list, required for add/cancel),\n    dispatch_date (YYYY-MM-DD, required for add; optional for list),",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    action: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    dispatch_date: z.unknown().optional(),
    po_number: z.unknown().optional(),
    quantity: z.unknown().optional(),
    reason: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
    unit: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "add_promo_volume", input as Record<string, unknown>);
  },
});
