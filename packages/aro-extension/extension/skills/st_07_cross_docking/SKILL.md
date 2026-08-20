---
name: st_07_cross_docking
description: "基于现有库存和建议订单分析 ARO 越库分配场景及其影响；当前仅提供查询和解释，不创建或提交越库单。"
---

# ST-07 越库分配（Cross-Dock Allocation）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-07 越库分配 |
| **ID** | `ST-07` |
| **Category** | Fulfillment / 履约网络 |
| **Layer** | Allocation Algorithm |
| **Tags** | `cross-dock`, `XD`, `ship-to`, `allocation`, `transit` |
| **Description** | 对进入 **cross-dock（越库）** 节点的在途库存，按优先级与公平性规则 **allocate** 到各 **ship-to** 门店或 DC，最小化二次搬运并满足服务时效承诺。 |

## 2. Execution Logic

### Steps

1. 读入 XD 批次：`inbound_qty`, `eta`, `sku_id`，及 ship-to 点需求（open SO、补货建议、min display）。
2. 定义优先级：紧急订单 > 低覆盖天数 > 合同 SLA；可加权得分。
3. 运行分配算法（proportional、max-min fairness、或 LP）：满足每点 `min_ship` 与 **整数箱/pack** 约束。
4. 输出每 ship-to 的 `allocated_qty` 与未满足需求 backlog。
5. 同步至 WMS/TMS 接口，生成拣货/分拨指令。

### Tools Used

- 网络主数据：ship-to、路由、承运窗口
- 需求与库存 API
- 可选：PuLP / OR-Tools

### Constraints

- 总分配 ≤ inbound；不可重复分配同一批次行。
- 若 ETA 延迟，触发重算与通知（联动 ST-09）。

### Expected Output

- 分配矩阵：`batch_id`, `ship_to_id`, `allocated_qty`, `priority_score`。

### 关联 Skills

- **ST-10** 同步后更新各点可用量；**ST-09** 对分配失衡或长时间 **unallocated** 库存告警。
- **ST-15** 可在履约争议时展示 XD 批次与分配依据。

### 异常与降级

- 实收短少：按比例缩减分配并触发 **reallocation** 与通知。
- ship-to 主数据失效：挂起该点需求，避免 silent drop。

## 3. Prompt Injection

输出契约：使用 **cross-dock**、**ship-to**、**allocation** 术语，说明公平性与优先级逻辑。入库批次数据缺失时不生成分配结果。
