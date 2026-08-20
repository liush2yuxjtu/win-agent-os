import { shadcnComponentDefinitions } from "@json-render/shadcn";
import { defineTool } from "eve/tools";
import { z } from "zod";

const AVAILABLE_COMPONENTS = Object.keys(shadcnComponentDefinitions).join(", ");

const SPEC_EXAMPLE = `{"root":"main","elements":{"main":{"type":"Stack","props":{"direction":"vertical","gap":"md"},"children":["card"]},"card":{"type":"Card","props":{"title":"标题","description":"说明"},"children":[]}},"state":{}}`;

/**
 * 渲染 json-render 交互 UI 到聊天面板（element-tree spec，@json-render/react 渲染）。
 *
 * 边界：
 *  - 只校验最小结构（root/elements），渲染容错由前端处理（非法 spec 回退文本）
 *  - spec 由模型生成，工具本身不做业务逻辑
 */
export default defineTool({
  description: `在聊天中渲染一个 json-render 交互 UI（element-tree spec，shadcn/ui 组件）。当用户要求「生成一个界面/表单/看板/清单」，或数据适合用卡片、表格、步骤条呈现时使用。可用组件：${AVAILABLE_COMPONENTS}。spec 结构：{ "root": string, "elements": { [key]: { "type": 组件名, "props": {...}, "children": [子元素 key] } }, "state": {} }。示例：${SPEC_EXAMPLE}。`,
  inputSchema: z.object({
    spec: z.string().describe("element-tree spec 的 JSON 字符串（含 root 和 elements；state 可选）"),
  }),
  async execute({ spec }) {
    try {
      const parsed: unknown = JSON.parse(spec);
      if (typeof parsed !== "object" || parsed === null) {
        return { ok: false, error: "spec 必须是 JSON 对象" };
      }
      const v = parsed as Record<string, unknown>;
      if (typeof v.root !== "string" || v.root.length === 0) {
        return { ok: false, error: "spec 必须包含非空 string 字段 root" };
      }
      if (typeof v.elements !== "object" || v.elements === null) {
        return { ok: false, error: "spec 必须包含对象字段 elements" };
      }
      return { ok: true, spec: JSON.stringify(parsed) };
    } catch {
      return { ok: false, error: "spec 不是合法 JSON，请修正后重试" };
    }
  },
});
