"use client";

import { useEffect, useState } from "react";

/**
 * /glossary/overview —— 业务口径总览页。
 * 术语值（服务端按快照计算，与 Excel SUMIF 同语义）+ 规则判定 + 动作 + 快照统计。
 */

interface Overview {
  ok: boolean;
  date: string;
  snapshot: { filled: number; total: number; byTable: { table: string; count: number }[] };
  terms: { name: string; definition: string; aggregation: string; value: number | null }[];
  rules: { name: string; expression: string; result: string; action: any }[];
}

const fmt = (v: number | null) => (v == null ? "—" : v.toLocaleString("zh-CN", { maximumFractionDigits: 2 }));

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/glossary/overview")
      .then((r) => r.json())
      .then((d) => (d.ok ? setData(d) : setError(d.error ?? "加载失败")))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p style={{ padding: "2rem" }}>❌ {error}</p>;
  if (!data) return <p style={{ padding: "2rem" }}>加载中…</p>;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", background: "#faf9f5", minHeight: "100vh" }}>
      <h1 style={{ fontSize: "1.4rem", margin: 0 }}>业务口径总览 · 数据截止 {data.date}</h1>
      <p style={{ color: "#b0aea5", fontSize: "0.85rem", margin: "0.4rem 0 1rem" }}>
        术语值 = 字段快照聚合（与 Excel SUMIF 公式同语义）；规则判定 = 真实数据求值
      </p>
      <div style={{ display: "flex", gap: "0.8rem", marginBottom: "1.2rem", flexWrap: "wrap" }}>
        <a
          href="/glossary"
          style={{ background: "#d97757", color: "#fff", textDecoration: "none", borderRadius: 6, padding: "0.45rem 1.1rem", fontSize: "0.9rem", fontWeight: 600 }}
        >
          ✏️ 打开 Excel 编辑器（Univer）→ http://localhost:3000/glossary
        </a>
        <a
          href="/api/glossary"
          style={{ background: "#fff", color: "#6b3523", textDecoration: "none", border: "1px solid #e8e6dc", borderRadius: 6, padding: "0.45rem 1.1rem", fontSize: "0.9rem" }}
        >
          ⬇️ 下载公式驱动 xlsx
        </a>
      </div>

      {/* 快照统计 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "0.7rem", marginBottom: "1.5rem" }}>
        <Card label="快照字段" value={`${data.snapshot.filled}/${data.snapshot.total}`} />
        {data.snapshot.byTable.map((t) => (
          <Card key={t.table} label={t.table} value={String(t.count)} />
        ))}
      </div>

      {/* 术语值 */}
      <h2 style={{ fontSize: "1.05rem" }}>业务术语（{data.terms.length}）</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: "0.7rem", margin: "0.7rem 0 1.5rem" }}>
        {data.terms.map((t) => (
          <div key={t.name} style={{ background: "#fff", border: "1px solid #e8e6dc", borderRadius: 8, padding: "0.8rem" }}>
            <div style={{ fontWeight: 600 }}>{t.name}</div>
            <div style={{ fontSize: "0.75rem", color: "#b0aea5" }}>{t.definition}</div>
            <div style={{ fontSize: "1.25rem", marginTop: "0.4rem" }}>
              {fmt(t.value)} <span style={{ fontSize: "0.7rem", color: "#b0aea5" }}>（{t.aggregation}）</span>
            </div>
          </div>
        ))}
      </div>

      {/* 规则判定 + 动作 */}
      <h2 style={{ fontSize: "1.05rem" }}>业务规则与动作（{data.rules.length}）</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: "0.7rem", marginTop: "0.7rem" }}>
        {data.rules.map((r) => {
          const pass = r.result === "1";
          return (
            <div
              key={r.name}
              style={{
                background: "#fff",
                border: `1px solid ${pass ? "#788c5d" : "#c44"}`,
                borderRadius: 8,
                padding: "0.9rem",
                borderLeft: `4px solid ${pass ? "#788c5d" : "#c44"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{r.name}</strong>
                <span style={{ fontWeight: 700, color: pass ? "#4a5c36" : "#c44" }}>
                  {pass ? "✅ 达标" : "❌ 不达标"}
                </span>
              </div>
              <div style={{ fontSize: "0.75rem", color: "#b0aea5", marginTop: "0.3rem" }}>{r.expression}</div>
              {r.action && (
                <div style={{ marginTop: "0.6rem", background: "#f4f1e8", borderRadius: 6, padding: "0.5rem 0.7rem", fontSize: "0.85rem" }}>
                  <div>
                    <strong>动作：</strong>
                    {r.action.name}
                    {pass && <span style={{ color: "#a25c3a", fontWeight: 600 }}> ← 触发</span>}
                  </div>
                  {r.action.trigger && <div style={{ color: "#6b6a63", marginTop: "0.2rem" }}>{r.action.trigger}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e8e6dc", borderRadius: 8, padding: "0.8rem" }}>
      <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: "0.75rem", color: "#b0aea5" }}>{label}</div>
    </div>
  );
}
