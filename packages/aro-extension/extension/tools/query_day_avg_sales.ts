import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Real-time day-avg from POS with anomaly filtering.\n\nIf bar_code given → single SKU; else batch (up to limit).\nlookback_days defaults to 90.",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    limit: z.unknown().optional(),
    lookback_days: z.unknown().optional(),
    po_number: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "query_day_avg_sales", input as Record<string, unknown>);
  },
});
