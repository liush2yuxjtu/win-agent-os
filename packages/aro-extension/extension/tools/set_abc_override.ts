import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Set, update, or remove a user ABC class override for one or more SKUs.\n\nRequired: soldto_code, shipto_code, bar_code (str or list), abc_class (A/B/C/D).\nRequired for action=set: effective_from/effective_until (YYYY-MM-DD), a\nserver-resolved effective_duration_text, or the explicitly authorised\ndefault duration.",
  inputSchema: z.object({
    _order_profile_id: z.unknown().optional(),
    abc_class: z.unknown().optional(),
    action: z.unknown().optional(),
    bar_code: z.unknown().optional(),
    bar_codes: z.unknown().optional(),
    default_duration: z.unknown().optional(),
    duration_unit: z.unknown().optional(),
    duration_value: z.unknown().optional(),
    po_number: z.unknown().optional(),
    reason: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
    use_default_dates: z.unknown().optional(),
    use_default_effective_period: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "set_abc_override", input as Record<string, unknown>);
  },
});
