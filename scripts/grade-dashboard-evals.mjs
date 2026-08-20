/**
 * edit-dashboard 技能 eval 自动评级脚本。
 * 对 iteration-N 的每个 eval 目录（with_skill / without_skill）检查产物，
 * 生成 grading.json（viewer 依赖 text/passed/evidence 字段）。
 *
 * 断言：
 *  - spec_has_root_elements   : 产物是合法 JSON 且含 root + elements
 *  - kpi_template_refs        : 5 张卡全部用 ${/kpis/N/...} 模板且索引覆盖 0..4
 *  - no_hardcoded_numbers     : 所有 $template 的非 ${} 文本不含数字（未固化数值）
 *  - layout_3_plus_2          : 存在 columns=3 与 columns=2 的 Grid（3+2 两行布局）
 *  - no_spec_generated        : 未生成任何看板 spec（无 /kpis/ 引用）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ITER = process.argv[2] ?? "iteration-1";
const ROOT = path.resolve(process.cwd(), "edit-dashboard-workspace", ITER);

const TEMPLATE_RE = /\$\{\/kpis\/(\d+)\/(label|value|change)\}/g;

function readJsonOrNull(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function collectTemplates(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectTemplates(item, out);
    return out;
  }
  if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$template") out.push(value);
      else collectTemplates(value, out);
    }
  }
  return out;
}

function gradeEval(evalDir) {
  const results = {};
  for (const variant of ["with_skill", "without_skill"]) {
    const outDir = path.join(evalDir, variant, "outputs");
    const specFile = path.join(outDir, "spec.json");
    const responseFile = path.join(outDir, "response.md");
    const expectations = [];
    const text = existsSync(responseFile) ? readFileSync(responseFile, "utf8") : "";

    if (existsSync(specFile)) {
      const spec = readJsonOrNull(specFile);
      const isTree = spec && typeof spec.root === "string" && typeof spec.elements === "object" && spec.elements !== null;
      expectations.push({
        text: "spec 是合法 element-tree（含 root 与 elements）",
        passed: Boolean(isTree),
        evidence: isTree ? `root=${spec.root}` : "spec.json 缺失或结构非法",
      });
      if (isTree) {
        const json = JSON.stringify(spec);
        const templates = collectTemplates(spec);
        const templateTexts = templates.filter((t) => typeof t === "string");
        const indexes = new Set();
        for (const t of templateTexts) {
          TEMPLATE_RE.lastIndex = 0;
          let m;
          while ((m = TEMPLATE_RE.exec(t))) indexes.add(Number(m[1]));
        }
        const allIndexes = indexes.size >= 5 && [0, 1, 2, 3, 4].every((i) => indexes.has(i));
        const cardTemplates = templateTexts.filter((t) => t.includes("/kpis/"));
        expectations.push({
          text: "5 张指标卡全部用 ${/kpis/N/...} 模板引用且索引覆盖 0..4",
          passed: allIndexes && cardTemplates.length >= 10,
          evidence: `索引集合=${[...indexes].sort().join(",")} 模板数=${cardTemplates.length}`,
        });
        // 去掉 ${...} 模板引用后，剩余字面文本不应含数字（split 带捕获组会混入索引，故用 replace）
        const literalText = templateTexts
          .map((t) => t.replace(/\$\{\/kpis\/\d+\/(label|value|change)\}/g, ""))
          .join(" ");
        const hasNumbers = /\d/.test(literalText);
        expectations.push({
          text: "未固化数值（$template 的非模板文本不含数字）",
          passed: !hasNumbers,
          evidence: hasNumbers ? `模板含数字：${literalText}` : "全部为纯模板引用",
        });
        const grids = Object.values(spec.elements).filter((el) => el && typeof el === "object" && el.type === "Grid");
        const columns = grids.map((g) => g.props?.columns).filter((c) => typeof c === "number");
        const has3And2 = columns.includes(3) && columns.includes(2);
        const hasHeading = Object.values(spec.elements).some((el) => el && typeof el === "object" && el.type === "Heading");
        expectations.push({
          text: "布局为 3+2 两行 Grid（或含标题）",
          passed: has3And2 || hasHeading,
          evidence: `Grid 列数=[${columns.join(",")}] 含Heading=${hasHeading}`,
        });
      }
    } else {
      const isNegative = /近7日成交|分析一下ROI|加预算/.test(text);
      const generatedSpec = text.includes("/kpis/") || text.includes("spec.json");
      expectations.push({
        text: "未生成看板 spec（纯数据分析问答）",
        passed: !generatedSpec,
        evidence: generatedSpec ? "输出中出现了 spec 产物痕迹" : "输出为纯文本分析",
      });
    }

    results[variant] = { expectations };
    writeFileSync(
      path.join(evalDir, variant, "grading.json"),
      JSON.stringify({ expectations }, null, 2),
    );
  }
  return results;
}

const evals = ["eval-0", "eval-1", "eval-2"];
for (const e of evals) {
  const dir = path.join(ROOT, e);
  if (!existsSync(dir)) continue;
  const r = gradeEval(dir);
  console.log(`\n=== ${e} ===`);
  for (const [variant, { expectations }] of Object.entries(r)) {
    const pass = expectations.filter((x) => x.passed).length;
    console.log(`${variant}: ${pass}/${expectations.length} 通过`);
    for (const ex of expectations) {
      console.log(`  ${ex.passed ? "✅" : "❌"} ${ex.text} — ${ex.evidence}`);
    }
  }
}
