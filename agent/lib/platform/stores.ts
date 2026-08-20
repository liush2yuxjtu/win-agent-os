/**
 * Store seam 的实体绑定：web profile 用 SQLite/web 实现，standalone/headless
 * 用 agent/lib/platform/fallback/ 下的 fs/JSON 降级实现。
 *
 * 选择器 getStore 定义在 agent/platform.ts（platform 装配层的统一出口）。
 */
import { getStore } from "../../platform";
import type { HistoryStore, ReportStore, SkillEvalsStore, SkillRegistryStore } from "../../platform";
import { HistoryStoreJson } from "./fallback/chat-history-json";
import { ReportStoreFs } from "./fallback/report-store-fs";
import { SkillEvalsStoreFs } from "./fallback/skill-evals-fs";
import { SkillRegistryStoreJson } from "./fallback/skill-registry-json";

import * as HistoryStoreSqlite from "./web/chat-sessions/db";
import * as ReportStoreSqlite from "./web/report-store/db";
import * as SkillEvalsHistoryWeb from "./web/skill-evals/history";
import * as SkillEvalsFeedbackWeb from "./web/skill-evals/feedback";
import * as SkillRegistryStoreWeb from "./web/skills/db";

const SkillEvalsStoreWeb: SkillEvalsStore = {
  loadHistory: SkillEvalsHistoryWeb.loadHistory,
  appendRun: SkillEvalsHistoryWeb.appendRun,
  getLastRun: SkillEvalsHistoryWeb.getLastRun,
  caseKey: SkillEvalsHistoryWeb.caseKey,
  buildComparison: SkillEvalsHistoryWeb.buildComparison,
  saveFeedback: SkillEvalsFeedbackWeb.saveFeedback,
  loadFeedback: SkillEvalsFeedbackWeb.loadFeedback,
  feedbackSummary: SkillEvalsFeedbackWeb.feedbackSummary,
};

export const historyStore = getStore<HistoryStore>(HistoryStoreSqlite as unknown as HistoryStore, HistoryStoreJson);
export const reportStore = getStore<ReportStore>(ReportStoreSqlite as unknown as ReportStore, ReportStoreFs);
export const skillRegistryStore = getStore<SkillRegistryStore>(SkillRegistryStoreWeb as unknown as SkillRegistryStore, SkillRegistryStoreJson);
export const skillEvalsStore = getStore(SkillEvalsStoreWeb, SkillEvalsStoreFs);
