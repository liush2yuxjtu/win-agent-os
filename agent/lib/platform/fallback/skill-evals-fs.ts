/**
 * standalone/headless 的技能评估历史/反馈降级实现。
 *
 * history/feedback 本来就是 fs/JSON（无 SQLite），web 与 headless 的
 * 文件布局一致（skill-packages/<name>/evals/feedback.json 与
 * .eve/artifacts/skill-evals/<skill>-history.json），因此直接复用
 * platform/web 下的实现，不重复造轮子。
 */
import {
  appendRun as appendRunFs,
  buildComparison as buildComparisonFs,
  caseKey as caseKeyFs,
  getLastRun as getLastRunFs,
  loadHistory as loadHistoryFs,
} from "../web/skill-evals/history";
import {
  feedbackSummary as feedbackSummaryFs,
  loadFeedback as loadFeedbackFs,
  saveFeedback as saveFeedbackFs,
} from "../web/skill-evals/feedback";
import type { SkillEvalsStore } from "../../../platform";

export const SkillEvalsStoreFs: SkillEvalsStore = {
  loadHistory: loadHistoryFs,
  appendRun: appendRunFs,
  getLastRun: getLastRunFs,
  caseKey: caseKeyFs,
  buildComparison: buildComparisonFs,
  saveFeedback: saveFeedbackFs,
  loadFeedback: loadFeedbackFs,
  feedbackSummary: feedbackSummaryFs,
};
