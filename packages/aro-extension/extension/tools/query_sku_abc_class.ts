import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Return one SKU's effective ABC class without recomputing anything.\n\nThis mirrors forecast selection: an active user override wins, otherwise the\npersisted sku_forecast class is used. A blank override reason is valid.",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    po_number: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "query_sku_abc_class", input as Record<string, unknown>);
  },
});
