import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "List prompt templates (optional category filter).",
  inputSchema: z.object({
    category: z.unknown().optional(),
    limit: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "get_templates", input as Record<string, unknown>);
  },
});
