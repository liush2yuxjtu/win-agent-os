---
name: st_06_allotment_guard
description: "查询 ARO SKU 在当前日期有效的配额、已用量、剩余量及建议数量是否可通过约束。可对单行运行约束校验并记录审计轨迹，但不修改订单数量、配额或业务配置。"
---

# ST-06 配额管控（Allotment Guard）

> Canonical Rule: `backend/app/rules/aro/allotment.md`。本 Skill 负责工具编排与交互；规则冲突时以该 Rule 文档为准。

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-06 配额管控 |
| **ID** | `ST-06` |
| **Category** | Constraint / 约束合规 |
| **Layer** | Policy Enforcement |
| **Tags** | `allotment`, `quota`, `cap`, `allocation` |
| **Description** | 在下单前，基于 `plant_code_quota`（剩余配额表）按日期有效性 + shipto + barcode 匹配配额记录，对配额品执行数量截断。 |

订单级配额查询使用 `aro__query_order_analysis`.quota_summary`，一次返回当前订单全部有效配额 SKU、已用满数量和截断结果；`aro__check_allotment` 仅用于指定单个 SKU。

## 2. Execution Logic

### Steps

1. **日期有效性过滤**：取当天日期 `today()`，从 `plant_code_quota` 表筛选满足 `today() >= quota_start_date AND today() <= quota_end_date` 的记录。
2. **匹配配额品**：在有效配额记录中，按 `shipto_code` + `bar_code` 匹配。
   - 匹配到记录 → 该 SKU 为**配额品**，进入第 3 步。
   - 未匹配到记录 → **非配额品**，不做额外处理，保留原建议量。
3. **计算剩余配额**：`remaining = max_quantity - order_total`（单位已经过单位转换后的建议订单量单位）。
4. **截断判定**：
   - 若 `建议量 ≤ remaining`：不截断，保留原建议量。
   - 若 `建议量 > remaining`：截断到 `remaining`，订单明细 reason 备注"配额截断"及配额详情（上限、已用、剩余、有效期）。
5. 写审计日志：`guard_name=AllotmentGuard`, `before_qty`, `after_qty`, `reason`。

### 数据源

- `plant_code_quota` 表（字段：soldto_code, shipto_code, bar_code, max_quantity, order_total, quota_start_date, quota_end_date）

### Tools Used

- `aro__check_allotment`：查询指定 SKU/shipto 的有效配额记录及剩余量
- `run_constraint_pipeline`：对指定订单行运行现有约束守卫，返回最终可通过数量和触发的守卫；只写审计轨迹，不修改订单明细
- `aro__query_filtered`：查询订单中已被约束排除或截断的明细与原因
- `AllotmentGuard`（ConstraintPipeline 中自动执行）

### Constraints

- 日期比较使用 ISO 格式字符串（YYYY-MM-DD），与表中存储格式一致。
- 未匹配到有效配额记录的 SKU 直接放行，不视为配额品。

### Expected Output

- 每行（仅配额品）：`requested_qty`, `approved_qty`（= min(requested, remaining)），`breach_flag`, `reason`（含配额截断说明）。

### 关联 Skills

- **ST-03** 补货计算第 6 步引用本 skill 的配额截断逻辑。
- **ST-08** 仅推送截断后的 `approved_qty`。
- **ST-05** 凑单行同样受配额约束。

### 异常与降级

- 配额表为空或无有效期内记录：所有 SKU 视为非配额品，不做截断。

## 3. Prompt Injection

输出契约：先按日期过滤有效配额，再按 shipto + barcode 匹配。配额品最终量为 min(建议量, 剩余配额)，截断写入 reason。配额数字必须来自系统数据或明确输入。
