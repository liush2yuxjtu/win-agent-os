import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Set/update/remove target stock days override for SKU(s) by barcode or keyword.\n\nWhen set, replenishment formula changes to:\n  restock = target_days × day_avg − available − in_transit\nreplacing the default:\n  restock = (OTD×forecast + safety_days×forecast) − available − in_transit",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    action: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    keyword: z.unknown().optional(),
    po_number: z.unknown().optional(),
    reason: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
    target_days: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "set_target_stock_days", input as Record<string, unknown>);
  },
});
