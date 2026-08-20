import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Recent AIToolCallLog rows.",
  inputSchema: z.object({
    limit: z.unknown().optional(),
    session_key: z.unknown().optional(),
    tool_name: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "get_execution_history", input as Record<string, unknown>);
  },
});
