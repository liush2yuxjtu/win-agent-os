import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Query AKBD mechanism usage from the calculated tracking table.",
  inputSchema: z.object({
    active_only: z.unknown().optional(),
    as_of_date: z.unknown().optional(),
    count: z.unknown().optional(),
    limit: z.unknown().optional(),
    mechanism_name: z.unknown().optional(),
    product_name: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "query_akbd_usage", input as Record<string, unknown>);
  },
});
