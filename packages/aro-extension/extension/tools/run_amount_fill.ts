import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    _track_refresh_diff: z.unknown().optional(),
    column_names: z.unknown().optional(),
    error: z.unknown().optional(),
    name: z.unknown().optional(),
    ok: z.unknown().optional(),
    order_profile_id: z.unknown().optional(),
    po_number: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    sku_name: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
    suggested_quantity: z.unknown().optional(),
    unique: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "run_amount_fill", input as Record<string, unknown>);
  },
});
