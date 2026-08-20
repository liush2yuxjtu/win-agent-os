import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "Lookup K from K-Risk Factor table given a target n(k)-k*N(-k) value.",
  inputSchema: z.object({
    target_nk: z.unknown().optional(),
  }),
  async execute(input) {
    return callTool(extension.config, "lookup_k_factor", input as Record<string, unknown>);
  },
});
