import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "List the Sold-To + Ship-To anomaly rules shared by all its profiles.",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    customer_code: z.unknown().optional(),
    limit: z.unknown().optional(),
    po_number: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
    store_code: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "list_anomaly_filters", input as Record<string, unknown>);
  },
});
