import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Preview ABC classification from POS sales data without changing cache.\n\nArchitecture: Tool layer (DB I/O) → Algorithm layer (alg_11 pure computation).\n\nRequired: soldto_code (or shipto_code auto-resolve).\nOptional (configurable by skill/user):",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    a_threshold: z.unknown().optional(),
    b_threshold: z.unknown().optional(),
    lookback_days: z.unknown().optional(),
    ok: z.unknown().optional(),
    po_number: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
    sorted_skus: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "run_abc_classification", input as Record<string, unknown>);
  },
});
