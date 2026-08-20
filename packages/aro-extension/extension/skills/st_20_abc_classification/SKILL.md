---
name: st_20_abc_classification
description: "查询或解释 ARO SKU 当前生效的 ABC 分类、分类计算规则、销量依据和只读分类预览。凡是询问指定 SKU 的 ABC 分类、ABC 如何计算或分类依据，都使用本 Skill 获取业务数据；该 Skill 不写入人工分类覆盖，设置、修改或删除覆盖必须使用 ABC 分类反馈。"
---

# ABCClassificationSkill — SKU ABC 分类

> Canonical Rule: `backend/app/rules/aro/abc_classification.md`。本 Skill 负责工具编排与交互；规则冲突时以该 Rule 文档为准。

## === Layer 1: 架构约束（架构师负责，修改需评审）===

### 工具权限
- 可调用: `aro__query_sku_abc_class` / `aro__run_abc_classification` / `aro__query_order_analysis` / `aro__query_day_avg_sales` / `aro__query_stock`
- 禁止: 直接修改生产数据库

### 输出格式
返回 JSON:
```json
{"ok":true,"class_counts":{"A":N,"B":N,"C":N,"D":N},"computed":N,"persisted":false,"samples":{...}}
```

### 架构规范
- Tool 层 (`aro__run_abc_classification`) 只读取 DB、组装参数并返回预览，不写 `sku_forecast`
- 当前订单的 ABC 分布使用 `aro__query_order_analysis`.abc_summary`，它读取订单快照全量 SKU；`aro__run_abc_classification` 是销售源预览，不能替代订单分布。
- 分类数量本身不证明分类不合理；订单问题只把 `abc_summary.review_flags` 作为直接待核对证据，不得将不同 SKU 范围的销售源预览与订单快照做数量对比，也不得仅凭 A/B/C/D 数量建议修改阈值。
- 算法逻辑由 `alg_11_abc_classification.main()` 执行，Tool 层不内嵌分类算法

## === Layer 2: 业务逻辑（业务专家负责，可自主编辑）===

### 分类规则

1. 从 POS 真实销售数据读取历史区间内（默认 30 天）每个 SKU 的销量总和
2. 按 SKU 销量降序排列
3. 累计贡献百分比分档：
   - **A 类**: 累计贡献 0% ~ a_threshold（默认 80%）的 SKU
   - **B 类**: 累计贡献 a_threshold ~ b_threshold（默认 80%~90%）的 SKU
   - **C 类**: 累计贡献底部（b_threshold ~ 100%）的 SKU
   - **D 类**: 历史区间内零销量的 SKU
4. `aro__run_abc_classification` 仅返回本次分类预览，不修改每日预测快照

### 与补货的关联
- 补货流程 (ST-03) 中，`aro__forecast_demand` 工具会根据 `abc_class` 选择预测档位：
  - A → 高档预测 (high)
  - B → 中档预测 (neutral)
  - C → 低档预测 (low)
  - D → 跳过预测
- 从源销售全量重跑订单链路不属于本只读预览工具；应按 ST-03 调用 `aro__calc_replenishment`(force_recompute=true, soldto_code, shipto_code)`
- 只有 `aro__calc_replenishment` 返回 `forecast_recomputed=true`，才可告知用户订单使用了新重算并写入的 ABC 和预测

### 使用场景
- ABC 分类预览使用 `aro__run_abc_classification`。
- 查询指定 SKU 当前生效分类时，先调用 `aro__query_sku_abc_class`。它返回的有效人工覆盖优先于 `sku_forecast`；覆盖记录的 `reason` 为空不代表覆盖失效。
- 已持久化分类与源销售预览必须明确区分。
- 补货流程需要最新分类和预测 → 由 ST-03 使用 `force_recompute=true` 一次完成范围刷新和订单生成

## === Layer 3: 运营参数（运营人员可调）===

- 历史回溯天数: 30（字段 lookback_days，可按需调整为 7/30/60/90）
- A 类阈值: 0.8（字段 a_threshold，累计销量贡献 80%）
- B 类阈值: 0.9（字段 b_threshold，累计销量贡献 90%）
- D 类规则: 区间内零销量自动归为 D 类
