import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Load PromptTemplate by template_key and substitute variables.",
  inputSchema: z.object({
    template_key: z.unknown().optional(),
    variables: z.unknown().optional(),
    vars: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "execute_template", input as Record<string, unknown>);
  },
});
