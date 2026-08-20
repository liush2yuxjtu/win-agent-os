import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Set/update/remove a time-bounded demand multiplier for SKU(s).\n\nParams:\n    soldto_code, bar_code (str or list), uplift_factor (float, required for set),\n    reason (str), effective_from (YYYY-MM-DD, required for set),\n    effective_until (YYYY-MM-DD, required for set),",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    action: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    effective_from: z.unknown().optional(),
    effective_until: z.unknown().optional(),
    po_number: z.unknown().optional(),
    reason: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
    uplift_factor: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "set_demand_uplift", input as Record<string, unknown>);
  },
});
