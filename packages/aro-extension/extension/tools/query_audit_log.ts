import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Recent audit_log entries.",
  inputSchema: z.object({
    action: z.unknown().optional(),
    limit: z.unknown().optional(),
    user_id: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "query_audit_log", input as Record<string, unknown>);
  },
});
