"use client";

import dynamic from "next/dynamic";

/**
 * /glossary —— glossarizer channel 的业务专家界面（Univer 真 Excel 引擎）。
 *
 * 展示公式驱动的口径 Excel（5 sheet），可编辑层与文件一致：
 *   业务规则 B 列（表达式）、业务动作 B~F 列可改；其余锁定。
 * 保存：收集可编辑单元格 → POST /api/glossary → 写回 rules.json → 重算 → 重新加载。
 */
const GlossEditor = dynamic(() => import("./editor"), { ssr: false, loading: () => <p>加载 Excel 引擎…</p> });

export default function GlossaryPage() {
  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.6rem 1.2rem",
          background: "#141413",
          color: "#faf9f5",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <strong>语义层 · 业务口径 Excel（glossarizer）</strong>
        <span style={{ opacity: 0.6, fontSize: "0.85rem" }}>
          字段标注/业务术语只读 · 业务规则/业务动作可编辑 · 保存后写回配置并重算
        </span>
        <a
          href="/glossary/overview"
          style={{ marginLeft: "auto", color: "#faf9f5", fontSize: "0.85rem", textDecoration: "none", border: "1px solid rgba(250,249,245,0.4)", borderRadius: 6, padding: "0.3rem 0.8rem" }}
        >
          业务口径总览 →
        </a>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <GlossEditor />
      </div>
    </main>
  );
}
