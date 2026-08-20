import { defineTool } from "eve/tools";
import { z } from "zod";
import extension from "../extension";
import { callTool } from "../lib/client";

export default defineTool({
  description:
    "运行 SLOG 凑单填充:为不足整箱/满额的目标生成凑单方案(展示候选,不直接落订单)。" +
    "配合 set_slog_preference / get_slog_preferences 管理凑单偏好。",
  inputSchema: z.object({
    soldto_code: z.string().optional().describe("客户代码(客户作用域下可不填)"),
    shipto_code: z.string().optional().describe("门店代码"),
    po_number: z.string().optional().describe("目标订单号"),
    bar_code: z.string().optional().describe("SKU 条码"),
  }),
  async execute(input) {
    return callTool(extension.config, "run_slog_fill", input as Record<string, unknown>);
  },
});
