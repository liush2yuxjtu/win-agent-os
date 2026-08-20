import { defineExtension } from "eve/extension";
import { z } from "zod";

export default defineExtension({
  config: z.object({
    mcpUrl: z.string().url().default("http://127.0.0.1:7333/mcp"),
    mcpToken: z.string().min(1).optional(),
  }),
});
