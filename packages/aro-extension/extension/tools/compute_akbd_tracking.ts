import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Recalculate active AKBD tracking rows from AKBD plan and sales delivery.",
  inputSchema: z.object({
    amount_values: z.unknown().optional(),
    as_of_date: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "compute_akbd_tracking", input as Record<string, unknown>);
  },
});
