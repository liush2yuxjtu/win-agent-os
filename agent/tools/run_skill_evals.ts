import fs from "node:fs";
import path from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getAgentPaths } from "../platform";
import { runSkillEvals } from "../lib/skill-evals";
import { appendRun, buildComparison, caseKey } from "../lib/platform/web/skill-evals/history";
import { syncEvalRun } from "../lib/platform/web/skill-evals/db";

/**
 * 技能评估工具：创建/修改技能后运行，产出两类评估报告：
 *  - Trigger（触发准确性）：description 路由命中测试（正例/负例）
 *  - Functional（功能正确性）：按 SKILL.md 指令执行质量的评判
 * 返回摘要 + 两份 HTML（供聊天内联渲染）+ 落盘路径（供下载）。
 *
 * Functional 支持两种执行来源（通过可选 executionResults 切换）：
 *  - 缺省：内部 LLM 模拟执行 + 评判（逐例并发 3）
 *  - 注入：model 用 agent 工具（并行）或 eval-runner 声明式子代理真实执行各用例后，
 *    把外部执行结果数组传给本工具，工具跳过内部模拟判定、直接采用注入的
 *    verdict/evidence/output 汇总落盘（未覆盖的用例仍走内部路径）。
 */
export default defineTool({
  description:
    "评估一个技能的触发准确性与功能正确性，返回摘要和两份 HTML 报告（Trigger 命中率 + Functional 通过率，含逐例明细）。创建或修改技能（SKILL.md/description）后应运行本工具验证质量，再决定上架。\n\n【可选·外部执行结果注入】若已用 agent 工具（并行）或 eval-runner 子代理真实执行了 functional 用例，可把各用例结果（caseId/input、verdict、evidence、output）通过 executionResults 传入——工具将跳过内部 LLM 模拟判定，直接采用注入结果汇总、出报告并落盘；未传入或未覆盖的用例仍走内部模拟路径。\n\n【调用前先告知用户预计耗时】评估逐例调用模型判定（外部注入真实执行时以子代理执行耗时为准），通常需要 2-5 分钟（用例越多越久），调用本工具前先用一句话告知用户「正在评估，预计 X 分钟」；执行期间前端工具卡片会显示已运行时间，无需用户操作。\n\n【重要】技能文件由本工具直接从项目技能目录加载（宿主文件系统），技能是否存在以本工具的返回为准 —— 不要先用 bash/glob/readFile 等工具去查找或验证技能文件（沙箱视角与宿主不一致会导致误判），直接调用本工具，若技能不存在会返回明确错误。\n\n【必做·评审 HITL】评估完成后，必须立即调用 ask_question 暂停，等待用户评审（建议 allowFreeform: true）：用户会在前端评审卡片上逐例标注（Trigger 例标「应触发/不应触发」、Functional 例给「通过/部分达标/失败」评价，均可加备注）并点击「提交评审」提交，或直接在对话中回复评审意见。在收到用户评审意见之前，不得解读/总结评估结果，不得按结果自行改进技能或进行任何其他动作；收到意见后，先用 submit_skill_review 把评审落盘到 evals/feedback.json，再按反馈改进（改 SKILL.md/description）、重跑评估验证、收尾。",
  inputSchema: z.object({
    skillName: z.string().describe("技能名（skill-packages/ 下的目录名，如 ai-control）"),
    executionResults: z
      .array(
        z.object({
          caseId: z.string().optional().describe("用例标识（可省略；input 未精确命中时按此匹配 FunctionalEvalCase.input）"),
          input: z.string().describe("任务输入（FunctionalEvalCase.input 原文，主匹配键）"),
          verdict: z.enum(["pass", "partial", "fail"]).describe("执行质量判定"),
          evidence: z.string().describe("判定依据/证据（写入评审卡的判定说明）"),
          output: z.string().describe("真实执行输出全文（评审材料）"),
        }),
      )
      .optional()
      .describe(
        "可选：外部注入的功能评估执行结果（model 编排 agent 工具或 eval-runner 子代理真实执行产出）。提供时 functional 判定跳过内部 LLM 模拟执行与评判、直接采用注入结果；不提供时行为与原来一致。",
      ),
  }),
  async execute({ skillName, executionResults }) {
    try {
      const { run, triggerHtml, functionalHtml, summary } = await runSkillEvals(skillName, {
        ...(executionResults && executionResults.length > 0 ? { executionResults } : {}),
      });
      const dir = getAgentPaths().skillEvalsDir;
      fs.mkdirSync(dir, { recursive: true });
      const triggerPath = path.join(dir, `${skillName}-trigger.html`);
      const functionalPath = path.join(dir, `${skillName}-functional.html`);
      fs.writeFileSync(triggerPath, triggerHtml, "utf8");
      fs.writeFileSync(functionalPath, functionalHtml, "utf8");
      // 工作区约定（SKILL.md 定义）：<repoRoot>/<skillName>-workspace/iteration-N/
      // 工具只负责把评估产物（HTML 等）写入本次迭代目录，编号取现有 iteration-N 的最大值 +1。
      const iteration = resolveNextIteration(skillName);
      const workspaceDir = path.join(getAgentPaths().repoRoot, `${skillName}-workspace`, `iteration-${iteration}`);
      fs.mkdirSync(workspaceDir, { recursive: true });
      const wsTriggerPath = path.join(workspaceDir, `${skillName}-trigger.html`);
      const wsFunctionalPath = path.join(workspaceDir, `${skillName}-functional.html`);
      fs.writeFileSync(wsTriggerPath, triggerHtml, "utf8");
      fs.writeFileSync(wsFunctionalPath, functionalHtml, "utf8");
      // summary 追加无技能基线对比行（无基线运行时保持原样）
      const triggerAcc = Math.round(run.trigger.accuracy * 100);
      let finalSummary = summary;
      if (run.baseline) {
        const baselineAcc = Math.round(run.baseline.triggerAccuracy * 100);
        const lift = triggerAcc - baselineAcc;
        finalSummary = `${summary}\n**无技能基线触发率**：${baselineAcc}%（对比：技能触发率 ${triggerAcc}% → 提升 ${lift} 个百分点）`;
      }
      const reportFiles = [triggerPath, functionalPath, wsTriggerPath, wsFunctionalPath];
      // 记录运行历史（迭代对比，JSON 坍缩布尔）
      const record = {
        ranAt: run.triggeredAt,
        iteration,
        triggerAccuracy: run.trigger.accuracy,
        functionalPassRate: run.functional.passRate,
        baselineTriggerAccuracy: run.baseline?.triggerAccuracy,
        triggerCases: Object.fromEntries(run.trigger.cases.map((c) => [caseKey(c.prompt), c.pass])),
        functionalCases: Object.fromEntries(run.functional.cases.map((c) => [caseKey(c.input), c.verdict === "pass"])),
        files: reportFiles,
      };
      appendRun(skillName, record);
      const comparison = buildComparison(skillName, record);
      // SQLite 同步：完整逐例数据（真实输出 / verdict 三态 / 依据）落库
      syncEvalRun({
        skillName,
        run,
        iteration,
        reportPaths: { trigger: wsTriggerPath, functional: wsFunctionalPath },
      });

      return {
        ok: true,
        skillName,
        iteration,
        workspaceDir,
        summary: finalSummary,
        triggerHtml,
        functionalHtml,
        triggerAccuracy: run.trigger.accuracy,
        functionalPassRate: run.functional.passRate,
        baselineTriggerAccuracy: run.baseline?.triggerAccuracy ?? null,
        // 逐例数据（供聊天内联评审交互：专家纠正是否应触发、评价功能输出；
        // 注入执行时 functional 例带 source: "injected" 与外部 evidence/output）
        triggerCases: run.trigger.cases,
        functionalCases: run.functional.cases,
        // 与上一次运行的对比（迭代改进后重跑时展示 diff）
        comparison,
        files: reportFiles,
      };
    } catch (error) {
      return {
        ok: false,
        skillName,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/** 工作区迭代号：<repoRoot>/<skillName>-workspace/ 下现有 iteration-N 的最大值 +1（无目录时从 1 开始）。 */
function resolveNextIteration(skillName: string): number {
  const workspaceRoot = path.join(getAgentPaths().repoRoot, `${skillName}-workspace`);
  let max = 0;
  try {
    for (const entry of fs.readdirSync(workspaceRoot)) {
      const m = entry.match(/^iteration-(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {
    // 工作区目录尚不存在 → iteration-1
  }
  return max + 1;
}
