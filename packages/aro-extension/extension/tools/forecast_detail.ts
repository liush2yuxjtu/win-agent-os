import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Return top-N sales days and top store per day for a SKU — supports user anomaly review.\n\nRequired: shipto_code or soldto_code, bar_code.\nOptional:\n  lookback (int, default 180) — days of history\n  top_days (int, default 3) — how many top days to show",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    lookback: z.unknown().optional(),
    po_number: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
    top_days: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "forecast_detail", input as Record<string, unknown>);
  },
});
