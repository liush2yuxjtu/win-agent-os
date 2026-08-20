import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Add, replace, or remove user-preferred SLOG SKUs for a ship-to.\nParams: soldto_code/shipto_code, bar_codes (list of str)\nAction: 'add' (default) | 'replace' (clear existing first) | 'remove' (delete specified) | 'clear' (delete all)",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    action: z.unknown().optional(),
    bar_codes: z.unknown().optional(),
    po_number: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "set_slog_preference", input as Record<string, unknown>);
  },
});
