---
name: st_16_param_tuning
description: "仅评估系统级 safety stock days、service level 与履约 KPI 的调优方案，输出受控的 sandbox 或 shadow 建议。不能修改任何 SKU 级目标库存天数，不能写入 target_stock_override，也不执行生产参数发布。"
---

# ST-16 参数调优（Safety Stock & Service Level Auto-Tuning）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-16 参数调优 |
| **ID** | `ST-16` |
| **Category** | Optimization / 自优化 |
| **Layer** | Feedback Loop |
| **Tags** | `auto-tune`, `safety-stock-days`, `service-level`, `feedback`, `bandit` |
| **Description** | 根据历史履约、缺货、审核反馈与 KPI（ST-12）对 **safety stock days**、**service level** 等参数做受控 **auto-tune**：在 sandbox 或 shadow 模式评估后再推广。 |

## 2. Execution Logic

### Steps

1. 收集反馈信号：POOS、fill rate、库存周转、人工 override 频率（ST-11）。
2. 定义目标函数：如加权缺货惩罚 + 持有成本；约束参数上下界与变更速率 **max_delta_per_week**。
3. 候选策略：网格搜索、贝叶斯优化、或 contextual bandit（按 ABC 分群）。
4. 在 holdout 窗口回测；通过 guardrail（不恶化 fill rate 超过 ε）后写入 **staging config**。
5. 审批后发布 production；记录 `tuning_run_id`, `old_params`, `new_params`, `metrics_delta`。

### Tools Used

- 实验平台 / feature flag
- 仿真器或历史重放 job

### Routing Boundary

- 此 Skill 只做系统级参数分析和调优建议，不执行生产写入。
- 对“指定 SKU 的目标库存天数改为/设为/删除为某值”的任务，必须路由到 `st_03_replenishment` 并调用 `aro__set_target_stock_days`，不能使用本 Skill。

### Constraints

- 禁止无界单步放大库存导致资金占用飙升。
- 所有变更可回滚；保留 A/B 标签供 ST-18 对比。

### Expected Output

- `proposal`: 参数新旧值、预期影响区间、置信度、生效时间窗。

### 关联 Skills

- 评估指标来自 **ST-12**；仿真可与 **ST-17** 交叉验证；上线后由 **ST-09** 观察副作用。
- **ST-02** K-matrix 与 **ST-01** 窗口可作为联合调优对象（需强治理）。

### 异常与降级

- 回测数据缺口：仅输出 **directional hint**，标记 `low_confidence`。
- guardrail 未通过：拒绝生成 production proposal，仅 sandbox 记录。

## 3. Prompt Injection

输出契约：聚焦 **safety stock days** 与 **service level**，展示 **feedback**、**guardrails** 和业务权衡。该能力不直接修改生产配置。
