import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "List proposed orders with optional PO, Ship-To, and type filters.",
  inputSchema: z.object({
    limit: z.unknown().optional(),
    po_number: z.unknown().optional(),
    po_type: z.unknown().optional(),
    shipto_code: z.unknown().optional(),
    soldto_code: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "query_orders", input as Record<string, unknown>);
  },
});
