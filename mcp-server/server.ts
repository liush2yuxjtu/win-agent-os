/**
 * glossarizer 的 json-render MCP App（对话内渲染业务口径 UI）。
 *
 * 工具：
 *   render-glossary-overview — 业务口径总览（术语值 + 规则判定 + 动作）
 *   render-glossary-rules    — 业务规则表（表达式 + 生成公式 + 引用链）
 * 数据源：http://localhost:3000/api/glossary/overview（与 /glossary 页面同一 channel）
 *
 * 运行：node mcp-server/server.mjs（构建后）或 tsx mcp-server/server.ts
 * Claude Code 配置：.mcp.json 注册 stdio server
 */
import { createMcpApp } from "@json-render/mcp";
import { buildAppHtml } from "@json-render/mcp/app";
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { z } from "zod";

const OVERVIEW_API = "http://localhost:3000/api/glossary/overview";

const catalog = defineCatalog(schema, {
  components: { ...shadcnComponentDefinitions },
  actions: {},
});

async function fetchOverview() {
  const res = await fetch(OVERVIEW_API);
  if (!res.ok) throw new Error(`overview API ${res.status}`);
  return res.json();
}

/** 业务口径总览 spec（确定性生成，数据来自 overview API） */
async function buildOverviewSpec(): Promise<unknown> {
  const d = await fetchOverview();
  const cards = d.terms.map((t: any) => ({
    type: "Card",
    props: {
      title: `${t.name} = ${t.value == null ? "—" : Number(t.value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`,
      description: `${t.definition}（${t.aggregation}）`,
      maxWidth: "md",
    },
  }));
  const rules = d.rules.map((r: any) => ({
    type: "Card",
    props: {
      title: `${r.result === "1" ? "✅" : "❌"} ${r.name}${r.result === "1" ? "（达标）" : "（不达标）"}`,
      description: `${r.expression}${r.action ? `｜动作：${r.action.name}` : ""}`,
      maxWidth: "full",
    },
  }));
  return {
    version: "1.0.0",
    state: {},
    layout: { type: "column", gap: "md" },
    components: [
      { type: "Heading", props: { text: `业务口径总览 · 数据截止 ${d.date}`, level: "h2" } },
      {
        type: "Card",
        props: {
          title: "打开业务口径 Excel（HTML 表格 + HyperFormula）",
          description: "http://localhost:3000/glossary · 可编辑业务规则与动作，保存后写回配置",
          maxWidth: "full",
        },
      },
      { type: "Grid", props: { columns: 3, gap: "md" }, slots: { default: cards } },
      { type: "Heading", props: { text: `业务规则与动作（${rules.length}）`, level: "h3" } },
      ...rules,
    ],
  };
}

async function main() {
  // 1. 构建 app HTML（esbuild 已把 app-entry 打包为 mcp-server/app.bundle.js）
  const js = readFileSync(new URL("./app.bundle.js", import.meta.url), "utf8");
  const html = buildAppHtml({ title: "glossarizer", js });

  // 2. MCP App
  const server = await createMcpApp({
    name: "glossary",
    version: "1.0.0",
    catalog,
    html,
  });

  // 3. 自定义工具（确定性 spec，不经 LLM 生成；spec JSON 文本 → iframe ontoolresult 渲染）
  await server.registerTool(
    "render-glossary-overview",
    {
      description:
        "渲染业务口径总览：术语值（字段快照聚合）、规则判定、动作触发状态。返回的 JSON 文本即 json-render spec，直接渲染。",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(await buildOverviewSpec()) }],
    }),
  );

  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error("[glossary-mcp]", e);
  process.exit(1);
});
