import { defineExtension } from "eve/extension";
import { z } from "zod";

export default defineExtension({
  config: z.object({
    /** aro backend(FastAPI)地址,如 http://127.0.0.1:8000 */
    baseUrl: z.string().url().default("http://127.0.0.1:8000"),
    /** backend 认证 token(可选;backend 侧鉴权放开时可不填) */
    token: z.string().optional(),
  }),
});
