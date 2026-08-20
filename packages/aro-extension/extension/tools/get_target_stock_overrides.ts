import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "List target-stock-days overrides for one exact order profile.",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    po_number: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "get_target_stock_overrides", input as Record<string, unknown>);
  },
});
