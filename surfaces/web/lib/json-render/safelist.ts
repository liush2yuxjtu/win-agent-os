/**
 * json-render shadcn 组件的动态 tailwind class 清单。
 *
 * shadcnComponents（@json-render/shadcn）的 Grid/Stack 等组件在运行时把
 * columns/gap 等 props 拼成 class 字符串（grid-cols-N、gap-N）—— 这些 class
 * 不在任何源码字面量里，tailwind v4 按需编译扫描不到，会导致布局无样式。
 * 本文件的存在让 tailwind 扫描到这些字符串并生成对应 CSS（官方 safelist 做法）。
 */
export const JSON_RENDER_SAFELIST = [
  "grid-cols-1",
  "grid-cols-2",
  "grid-cols-3",
  "grid-cols-4",
  "grid-cols-5",
  "grid-cols-6",
  "gap-0",
  "gap-2",
  "gap-3",
  "gap-4",
  "gap-6",
] as const;
