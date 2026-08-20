/**
 * Excel → JSON 双向映射（薄封装，核心逻辑在 glossarizer lib/excel-import.ts）。
 *
 * 用法: tsx scripts/import-excel.mts [--file glossary-review.xlsx] [--dry-run]
 */
import { resolve } from "node:path";
import { importEdits } from "../packages/glossarizer/extension/lib/excel-import.ts";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const file =
  (args.find((a) => a.startsWith("--file="))?.split("=")[1] ?? (fileIdx >= 0 ? args[fileIdx + 1] : undefined)) ??
  "glossary-review.xlsx";
const dryRun = args.includes("--dry-run");

const result = importEdits(ROOT, file, { dryRun });
if (result.errors.length > 0) {
  console.error("❌ 校验失败，未写回：");
  for (const e of result.errors) console.error("  -", e);
  process.exit(1);
}
if (result.changes.length === 0) {
  console.log("无变更（Excel 与 JSON 一致）");
  process.exit(0);
}
console.log(`📝 ${result.changes.length} 处变更：`);
for (const c of result.changes) console.log("  ", c);
if (result.written) {
  console.log("✅ 已写回: configs/qianchuan.rules.json");
  console.log("下一步: tsx scripts/evaluate-rules.mts && 重新导出 Excel");
} else {
  console.log("（--dry-run，未写回）");
}
