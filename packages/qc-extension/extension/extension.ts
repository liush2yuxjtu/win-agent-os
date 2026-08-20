import { defineExtension } from "eve/extension";
import { z } from "zod";

export default defineExtension({
  config: z.object({
    mcpBridgeUrl: z.string().default("http://127.0.0.1:7331/mcp"),
    mcpBridgeToken: z.string().optional(),
  }),
});
