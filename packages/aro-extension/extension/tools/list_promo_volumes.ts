import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "List active promo volume additions. Shortcut for add_promo_volume(action='list').",
  inputSchema: z.object({
    action: z.unknown().describe("必填"),
    _order_profile_id: z.unknown().optional(),
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
    return callTool(extension.config, "list_promo_volumes", input as Record<string, unknown>);
  },
});
