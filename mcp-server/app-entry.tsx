/**
 * json-render MCP App 入口（esbuild 打包为单 JS，buildAppHtml 内嵌）。
 * 渲染 render-glossary-* 工具返回的 spec。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { JSONUIProvider, Renderer, defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { useJsonRenderApp } from "@json-render/mcp/app";

const { registry } = defineRegistry(
  {},
  {
    components: {
      Card: shadcnComponents.Card,
      Stack: shadcnComponents.Stack,
      Grid: shadcnComponents.Grid,
      Table: shadcnComponents.Table,
      Heading: shadcnComponents.Heading,
      Text: shadcnComponents.Text,
      Separator: shadcnComponents.Separator,
      Button: shadcnComponents.Button,
    },
    actions: {},
  },
);

function McpApp() {
  const { spec, loading, error } = useJsonRenderApp();
  if (error) return <div style={{ padding: 16, color: "#c44" }}>Error: {error.message}</div>;
  if (!spec) return <div style={{ padding: 16, color: "#888" }}>等待 spec…</div>;
  return (
    <JSONUIProvider registry={registry} initialState={spec.state ?? {}}>
      <Renderer spec={spec} registry={registry} loading={loading} />
    </JSONUIProvider>
  );
}

const el = document.getElementById("root");
if (el) createRoot(el).render(<McpApp />);
