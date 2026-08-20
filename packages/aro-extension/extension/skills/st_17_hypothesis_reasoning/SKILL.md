---
name: st_17_hypothesis_reasoning
description: "对 ARO 补货算法进行假设分析、回测和方案比较，输出模拟结论；不修改生产参数、订单或客户配置。"
---

# ST-17 假设推理（What-If Analysis）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-17 假设推理 |
| **ID** | `ST-17` |
| **Category** | Simulation / 仿真 |
| **Layer** | Counterfactual |
| **Tags** | `what-if`, `scenario`, `sensitivity`, `counterfactual` |
| **Description** | 对用户提出的 **what-if** 假设（如 lead time +3 天、service level 99%→95%、促销 uplift +20%）进行参数敏感性推演，估算对 **SS**、**replenishment qty**、**POOS** 的定性或定量影响。 |

## 2. Execution Logic

### Steps

1. 解析假设集合 `H = {param_i → new_value_i}`，校验与本体/配置允许范围。
2. 冻结基准场景：`baseline` 来自最近一次快照或用户给定基线。
3. 重算受影响模块：优先 ST-02、ST-03；必要时联动 ST-01 uplift。
4. 输出对比表：`metric`, `baseline`, `scenario`, `delta`, `delta_pct`。
5. 标注假设强度与可信度：数据驱动 vs 纯推理；列 **sensitivity** 等级。

### Tools Used

- 计算引擎（复用与生产一致公式，或简化 analytic proxy）
- 可选：蒙特卡洛对 demand 噪声抽样

### Constraints

- 明确声明 **未执行真实下单**；结果非承诺。
- 多假设交互时检查相关性（避免重复计入同一效应）。

### Expected Output

- `scenario_id`, `assumptions[]`, `comparison_table`, `narrative_summary`。

### 关联 Skills

- 公式与模块对齐 **ST-02**、**ST-03**、**ST-04**；概念澄清可调用 **ST-14**。
- 若用户考虑调参落地，衔接 **ST-16** 的实验与审批流。

### 异常与降级

- 假设互斥：检测并提示 **inconsistent_assumptions**。
- 计算超时：返回解析解或单步敏感性，附 **partial_result** 标记。

## 3. Prompt Injection

输出契约：展示 **baseline vs scenario** 对比，区分仿真与实况；基线数据缺失时列出所需输入，不将推测表述为已发生事实。
