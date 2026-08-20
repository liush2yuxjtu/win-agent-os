"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { HyperFormula } from "hyperformula";

/**
 * 业务口径 Excel（HTML 表格 + HyperFormula 公式引擎）。
 *
 * - 数据：GET /api/glossary 的公式驱动 xlsx（SheetJS 解析）
 * - 计算：HyperFormula 实时求值（SUMIF/MAXIFS/IF，与 Excel 同语义）
 * - 编辑：锁定单元格只读（灰底），可编辑单元格（规则表达式列 / 动作列）白底可改
 * - 保存：收集可编辑单元格 → POST /api/glossary → 写回 rules.json → 重算 → 重载
 */

interface Cell {
  v: string | number | null;
  f?: string; // 公式（如 =SUMIF(...)）
  locked: boolean;
}
interface SheetData {
  name: string;
  rows: Cell[][];
}

export default function Editor() {
  const hfRef = useRef<HyperFormula | null>(null);
  const sheetIndex = useRef<string[]>([]);
  const [data, setData] = useState<{ sheets: SheetData[]; active: number } | null>(null);
  const [status, setStatus] = useState("加载中…");
  const [saving, setSaving] = useState(false);
  const [, force] = useState(0);

  const load = async () => {
    const res = await fetch("/api/glossary");
    if (!res.ok) throw new Error(`GET /api/glossary ${res.status}`);
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });

    const sheets: SheetData[] = [];
    const hfSheets: Record<string, (string | number | null)[][]> = {};
    sheetIndex.current = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws || !ws["!ref"]) continue;
      const range = XLSX.utils.decode_range(ws["!ref"]);
      const rows: Cell[][] = [];
      const matrix: (string | number | null)[][] = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: Cell[] = [];
        const mrow: (string | number | null)[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (!cell) {
            row.push({ v: null, locked: true });
            mrow.push(null);
            continue;
          }
          const f = cell.f ? (cell.f.startsWith("=") ? cell.f : `=${cell.f}`) : undefined;
          row.push({ v: cell.v == null ? null : cell.v, f, locked: true });
          mrow.push(f ?? (cell.v == null ? null : cell.v));
        }
        rows.push(row);
        matrix.push(mrow);
      }
      sheets.push({ name, rows });
      hfSheets[name] = matrix;
      sheetIndex.current.push(name);
    }

    // HyperFormula：公式单元格实时计算
    const hf = HyperFormula.buildFromSheets(hfSheets, { licenseKey: "gpl-v3" });
    hfRef.current = hf;
    setData({ sheets, active: 0 });
    setStatus("已加载（公式实时计算）");
  };

  useEffect(() => {
    load().catch((e) => setStatus(`加载失败: ${String(e)}`));
  }, []);

  const hfVal = (sheet: string, row: number, col: number): string => {
    const hf = hfRef.current;
    if (!hf) return "";
    try {
      const v = hf.getCellValue({ sheet: sheetIndex.current.indexOf(sheet), row, col });
      return v == null ? "" : String(v);
    } catch {
      return "";
    }
  };

  const active = data?.sheets[data.active];

  const rendered = useMemo(() => {
    if (!active) return null;
    return active.rows.map((row, r) => (
      <tr key={r}>
        {row.map((cell, c) => {
          const isHeader = r === 0;
          const colLabel = isHeader ? "" : String(active.rows[0][c]?.v ?? "");
          const editable =
            !isHeader &&
            (active.name === "业务规则"
              ? colLabel === "表达式"
              : active.name === "业务动作"
                ? ["动作名", "动作类型", "触发条件", "动作参数", "执行人"].includes(colLabel)
                : false);
          const display = cell.f ? hfVal(active.name, r, c) : cell.v == null ? "" : String(cell.v);
          return (
            <td
              key={c}
              style={{
                border: "1px solid #e0ddd3",
                padding: 0,
                background: isHeader ? "#f0ede4" : cell.locked ? "#faf9f5" : "#fff",
                minWidth: 90,
              }}
            >
              {editable ? (
                <input
                  defaultValue={display}
                  onBlur={(e) => {
                    try {
                      const hf = hfRef.current;
                      if (!hf) return;
                      hf.setCellContents({ sheet: sheetIndex.current.indexOf(active.name), row: r, col: c }, e.target.value);
                      // 同步写回快照，保证保存时 collectEdits 读到的是用户输入而非加载时旧值
                      setData((prev) => {
                        if (!prev) return prev;
                        const si = sheetIndex.current.indexOf(active.name);
                        return {
                          ...prev,
                          sheets: prev.sheets.map((s, i) =>
                            i !== si
                              ? s
                              : {
                                  ...s,
                                  rows: s.rows.map((row, ri) =>
                                    ri !== r
                                      ? row
                                      : row.map((cell, ci) => (ci !== c ? cell : { ...cell, v: e.target.value, f: undefined })),
                                  ),
                                },
                          ),
                        };
                      });
                      force((x) => x + 1);
                    } catch {
                      /* noop */
                    }
                  }}
                  style={{
                    width: "100%",
                    border: "none",
                    padding: "4px 8px",
                    background: "#fff",
                    fontSize: 13,
                    outline: "1px solid #d97757",
                    outlineOffset: -1,
                  }}
                />
              ) : (
                <div
                  title={cell.f ? cell.f : undefined}
                  style={{
                    padding: "4px 8px",
                    fontSize: 13,
                    fontFamily: cell.f ? "ui-monospace, monospace" : "inherit",
                    color: cell.f ? "#3a8e8e" : "inherit",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 260,
                  }}
                >
                  {display || " "}
                  {cell.f && <span style={{ color: "#b0aea5", fontSize: 11, marginLeft: 6 }}>ƒ</span>}
                </div>
              )}
            </td>
          );
        })}
      </tr>
    ));
  }, [data, active, force]);

  const collectEdits = () => {
    if (!data) return [];
    const edits: { sheet: string; row: string; col: string; value: string }[] = [];
    for (const s of data.sheets) {
      if (s.name !== "业务规则" && s.name !== "业务动作") continue;
      const header = s.rows[0] ?? [];
      const colName = (c: number) => (header[c]?.v ?? "").toString();
      // 可编辑列（与后端 import-excel 契约一致）：规则=表达式列，动作=动作名/类型/触发/参数/执行人列
      const EDITABLE_COLS = new Set(
        s.name === "业务规则"
          ? ["表达式"]
          : s.name === "业务动作"
            ? ["动作名", "动作类型", "触发条件", "动作参数", "执行人"]
            : [],
      );
      for (let r = 1; r < s.rows.length; r++) {
        const nameCell = s.rows[r][0];
        if (!nameCell?.v) continue;
        const rowName = String(nameCell.v);
        for (let c = 0; c < s.rows[r].length; c++) {
          const cell = s.rows[r][c];
          if (!EDITABLE_COLS.has(colName(c))) continue; // 只收集可编辑列
          edits.push({
            sheet: s.name,
            row: rowName,
            col: colName(c),
            value: cell.f ? hfVal(s.name, r, c) : cell.v == null ? "" : String(cell.v),
          });
        }
      }
    }
    return edits;
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const edits = collectEdits();
      if (edits.length === 0) throw new Error("未找到可编辑单元格");
      const res = await fetch("/api/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits }),
      });
      const d = await res.json();
      if (!d.ok) {
        setStatus(`保存失败: ${d.error ?? JSON.stringify(d.errors)}`);
        return;
      }
      await load();
      setStatus(
        `✅ 已保存 ${d.changes.length} 处变更 → 已写回配置并重算：` +
          Object.entries(d.results as Record<string, string>)
            .map(([k, v]) => `${k}=${v}`)
            .join("，"),
      );
    } catch (e) {
      setStatus(`保存失败: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", padding: "0.5rem 1.2rem", borderBottom: "1px solid #e8e6dc", background: "#faf9f5" }}>
        <button
          onClick={save}
          disabled={saving}
          style={{ background: "#d97757", color: "#fff", border: "none", borderRadius: 6, padding: "0.45rem 1.2rem", cursor: saving ? "wait" : "pointer", fontWeight: 600 }}
        >
          {saving ? "保存中…" : "💾 保存（写回配置并重算）"}
        </button>
        <span style={{ fontSize: "0.85rem", color: "#6b6a63" }}>{status}</span>
      </div>
      {data && (
        <>
          <div style={{ display: "flex", gap: "0.4rem", padding: "0.5rem 1.2rem", borderBottom: "1px solid #e8e6dc", background: "#fff" }}>
            {data.sheets.map((s, i) => (
              <button
                key={s.name}
                onClick={() => setData({ ...data, active: i })}
                style={{
                  background: i === data.active ? "#141413" : "#f0ede4",
                  color: i === data.active ? "#faf9f5" : "#141413",
                  border: "none",
                  borderRadius: 5,
                  padding: "0.3rem 0.9rem",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: "auto", background: "#fff" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
              <tbody>{rendered}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
