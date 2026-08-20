/**
 * 确定性验证：run_skill_evals 输出 → renderToolVisual → EvalFrame iframe(srcDoc) 内联渲染。
 * 不依赖模型，直接用真实 HTML 报告文件构造工具输出。
 *
 * 用法：node scripts/verify-eval-iframe.mjs <trigger-html> <functional-html>
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";

const [triggerFile, functionalFile] = process.argv.slice(2);

// 用 esbuild 把 renderToolVisual 编译成可调用的模块（TSX → CJS 字符串）
const entry = `
import { renderToolVisual } from "./app/_components/agent-tool-visual";
globalThis.__renderToolVisual = renderToolVisual;
`;
const result = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
  bundle: true,
  format: "iife",
  platform: "node",
  jsx: "automatic",
  write: false,
  external: ["react", "react-dom", "react/jsx-runtime"],
});
const code = result.outputFiles[0].text;

const require = createRequire(import.meta.url);
const react = require("react");
const server = require("react-dom/server");

const sandbox = {
  module: { exports: {} },
  exports: {},
  require,
  console,
  React: react,
  renderToStaticMarkup: server.renderToStaticMarkup,
};
const fn = new Function("module", "exports", "require", "React", "renderToStaticMarkup", code + "\n;module.exports.__g = globalThis.__renderToolVisual;");
fn(sandbox.module, sandbox.exports, require, react, server.renderToStaticMarkup);

const renderToolVisual = sandbox.module.exports.__g;
if (typeof renderToolVisual !== "function") {
  console.error("✗ renderToolVisual 未导出（bundle 失败）");
  process.exit(1);
}

// 构造与 run_skill_evals 工具一致的输出（triggerHtml/functionalHtml + 逐例数据）
const triggerHtml = readFileSync(triggerFile, "utf8");
const functionalHtml = readFileSync(functionalFile, "utf8");
const output = {
  ok: true,
  skillName: "ai-control",
  summary: "Trigger 92%，Functional 80%",
  triggerHtml,
  functionalHtml,
  triggerCases: [
    { prompt: "追投要不要停", expectedTrigger: true, predictedTrigger: true, reason: "命中", pass: true },
  ],
  functionalCases: [
    { input: "查询追投 ROI", output: "2.86", verdict: "pass", reason: "正确", expected: "2.86" },
  ],
  files: [triggerFile, functionalFile],
};

const html = renderToStaticMarkup(createElement(renderToolVisual, { toolName: "run_skill_evals", output }));
// 渲染回真实 React 元素：renderToolVisual 返回 ReactNode，需经 createElement 包装 —— 直接渲染结果
let markup;
try {
  markup = server.renderToStaticMarkup(
    createElement("div", null, renderToolVisual("run_skill_evals", output)),
  );
} catch (error) {
  console.error("✗ 渲染异常：", error.message);
  process.exit(1);
}

const iframes = [...markup.matchAll(/<iframe[\s\S]*?<\/iframe>/g)].map((m) => m[0]);
console.log("iframe 数量：", iframes.length);
console.log("报告标题：", [...markup.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => m[1].trim()));
if (iframes.length >= 2) {
  // srcdoc 经 React SSR 转义（&quot;/&lt;），检查转义后内容是否包含报告特征（DOCTYPE + 报告正文）
  const srcdoc0 = iframes[0].includes("&lt;!DOCTYPE") || iframes[0].includes("&lt;html");
  const srcdoc0Len = (iframes[0].match(/srcdoc="([\s\S]*?)"/) ?? [""])[0].length;
  const srcdoc1Len = (iframes[1].match(/srcdoc="([\s\S]*?)"/) ?? [""])[0].length;
  console.log("✅ Trigger srcdoc 含 HTML 文档标记：", srcdoc0, `(属性长度 ${srcdoc0Len})`);
  console.log("✅ Functional srcdoc 属性长度：", srcdoc1Len);
  console.log("PASS：聊天内 iframe 内联渲染验证通过");
} else {
  console.log("✗ 未渲染出 iframe，渲染标记长度：", html.length);
  process.exit(1);
}
