import { defineTool } from "eve/tools";
import { z } from "zod";
import { shadcnComponentDefinitions } from "@json-render/shadcn";

/**
 * 可用 json-render 组件类型清单（单一来源：运行时枚举 @json-render/shadcn 的
 * component definitions + 自定义组件）。模型生成 element-tree spec 前调用，
 * 避免拼出不存在的组件 type（渲染端对未知 type 无兜底，直接空渲染）。
 *
 * 可视化能力不止组件：spec 级动态能力（$state/$bindState/$cond/$template/
 * $computed 表达式、repeat 列表、visible 条件、watch 状态监听、表单校验）
 * 与组件组合使用，见 SPEC_CAPABILITIES。
 */

/** 组件类型 → 一句话用途（帮助模型选型；渲染层不消费，纯提示）。 */
const COMPONENT_HINTS: Record<string, string> = {
  Card: "卡片容器（title/description + children）",
  Stack: "flex 容器（direction/vertical|horizontal、gap）",
  Grid: "网格容器（columns 响应式降级）",
  Table: "数据表格（rows 数组的数组 + columns 字符串数组，经 normalizeTableProps 归一化）",
  Heading: "标题（level 1-3）",
  Text: "文本（variant: muted 等）",
  Badge: "徽标",
  Alert: "提示条",
  Progress: "进度条",
  Tabs: "标签页",
  Accordion: "折叠面板",
  Dialog: "对话框",
  Drawer: "抽屉",
  Carousel: "轮播",
  Button: "按钮",
  Link: "链接",
  Input: "输入框",
  Textarea: "多行输入",
  Select: "下拉选择",
  Checkbox: "复选框",
  Radio: "单选",
  Switch: "开关",
  Slider: "滑条",
  Separator: "分隔线",
  Tooltip: "悬浮提示",
  Popover: "弹出层",
  DropdownMenu: "下拉菜单",
  Toggle: "开关按钮",
  ToggleGroup: "开关组",
  ButtonGroup: "按钮组",
  Pagination: "分页",
  Skeleton: "骨架屏",
  Spinner: "加载中",
  Image: "图片",
  Avatar: "头像",
  BarChart: "自绘柱状图（data 对象数组：{label, value, ...}，支持按周期过滤）",
};

/** spec 级动态能力：与组件组合实现交互/数据绑定（渲染层原生支持）。 */
const SPEC_CAPABILITIES = [
  {
    name: "$state 表达式",
    syntax: '{ "$state": "/path" }',
    note: "读取状态模型值（props 任意字段可配）",
  },
  {
    name: "$bindState 双向绑定",
    syntax: '{ "$bindState": "/path" }',
    note: "表单组件（value/checked 等）读写状态",
  },
  {
    name: "$cond 条件值",
    syntax: '{ "$cond": { "$state": "/x", "eq": "a" }, "$then": 1, "$else": 2 }',
    note: "按状态取不同值",
  },
  {
    name: "$template 插值",
    syntax: '{ "$template": "你好，${/user/name}！" }',
    note: "字符串模板引用状态",
  },
  {
    name: "$computed 计算",
    syntax: '{ "$computed": "fnName", "args": { "key": <expr> } }',
    note: "调用注册的计算函数（需 registry 提供）",
  },
  {
    name: "repeat 列表",
    syntax: '{ "repeat": { "statePath": "/items", "key": "id" } }',
    note: "按状态数组重复渲染子元素（$bindItem 绑定字段）",
  },
  {
    name: "visible 条件显示",
    syntax: '{ "visible": { "$state": "/x", "eq": "a" } }',
    note: "元素级显隐（支持 and/or/not 组合）",
  },
  {
    name: "watch 状态监听",
    syntax: '{ "watch": { "/path": { "action": "name", "params": {} } } }',
    note: "状态变化触发动作（不触发初始渲染）",
  },
  {
    name: "表单校验",
    syntax: "validation 字段 + check.* 规则",
    note: "required/email/numeric/min/max/pattern/requiredIf 等",
  },
];

export default defineTool({
  description:
    "列出 json-render element-tree spec 可用的全部可视化能力：组件类型（component type，shadcn + 自定义）+ spec 级动态能力（$state 表达式/repeat/visible/watch/表单校验等）。生成看板卡片/UI spec 前先调用本工具确认组件名与能力语法，避免使用不存在的组件类型导致渲染为空。返回组件清单 + 动态能力语法。",
  inputSchema: z.object({}),
  async execute() {
    const types = [...Object.keys(shadcnComponentDefinitions), "BarChart"].sort();
    return {
      ok: true,
      count: types.length,
      components: types.map((type) => ({
        type,
        hint: COMPONENT_HINTS[type] ?? "通用组件（详见组件文档）",
      })),
      capabilities: SPEC_CAPABILITIES,
      note: "spec 元素 type 必须是上述之一；Table 的 rows 支持对象数组（会自动归一化）；Grid 在窄容器自动降列数；动态能力与组件组合实现交互/数据绑定。",
    };
  },
});
