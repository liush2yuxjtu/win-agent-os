---
name: st_11_order_review
description: "查询并审核 ARO 建议订单、SKU 明细、过滤记录和采购订单回传信息，适用于审单页面的只读解释；不重算或修改订单。"
---

# ST-11 订单审核（AI Confidence-Based Review）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-11 订单审核 |
| **ID** | `ST-11` |
| **Category** | Governance / 治理 |
| **Layer** | Human-in-the-Loop |
| **Tags** | `review`, `confidence`, `HITL`, `approval-workflow` |
| **Description** | 基于模型或规则输出的 **AI confidence** 与风险因子，将订单路由到 **auto-approve**、**spot check** 或 **mandatory review** 队列，形成可审计的审核工作流。 |

## 2. Execution Logic

### Steps

1. 特征提取：金额、新 SKU、配额逼近、历史拒单率、异常标签（ST-09）。
2. 计算 `confidence_score` ∈ [0,1] 与 `risk_tier`（规则表或 ML 概率校准）。
3. 路由：`confidence ≥ τ_high` 且无私募规则命中 → auto；`τ_low < score < τ_high` → sample review；否则 full review。
4. 审核人 UI：展示解释摘要（ST-15 可复用片段）、差异行、建议动作。
5. 落库：`reviewer_id`, `decision`, `decision_ts`, `comments`；回写订单状态。

### Tools Used

- 订单与规则服务
- `query_purchase_orders`：查询当前权限范围内的实际采购订单及可选明细
- 可选：可解释性摘要（SHAP 简版或 key drivers 列表）

### Constraints

- 监管/合同要求人工的 SKU 必须 bypass auto。
- Confidence 不可作为唯一法律依据；须保留人工 override。

### Expected Output

- `order_id`, `routing_bucket`, `confidence_score`, `review_status`, `sla_deadline`。

### 关联 Skills

- 消费 **ST-09** 风险标签、**ST-06** 截断提示；通过后交给 **ST-08**；解释可链 **ST-15**。
- **ST-12** **adoption rate** 可区分 auto vs reviewed 路径。

### 异常与降级

- 模型推理超时：默认进入 **full review** 并记 `fallback=timeout`。
- 审核队列堆积：动态降低 `τ_high` 或扩容人力（运营策略，非模型自动）。

## 3. Prompt Injection

输出契约：围绕 **AI confidence** 与 **review workflow** 说明审核档位和 SLA，保留 score、bucket 字段名。人工保留最终决策权。
