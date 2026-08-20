---
name: st_09_anomaly_detection
description: "分析 ARO 销量、库存和运营指标中的异常信号，给出风险解释和排查建议；不写入异常过滤规则。要新增或取消门店异常过滤，应使用预测异常反馈。"
---

# ST-09 异常检测（Anomaly Detection）

> Canonical Rules: `backend/app/rules/aro/forecast.md` 与 `feedback_update.md`。本 Skill 负责检测编排与交互；规则冲突时以 Rule 文档为准。

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-09 异常检测 |
| **ID** | `ST-09` |
| **Category** | Monitoring / 监控 |
| **Layer** | Analytics + Rules |
| **Tags** | `anomaly`, `stock-drop`, `sales-spike`, `push-failure`, `alert` |
| **Description** | 检测 **stock drops（库存骤降）**、**sales spikes（销量尖峰）**、**push failures（推送失败）** 等异常模式，生成告警与根因线索（关联订单、盘点、接口错误码）。 |

## 2. Execution Logic

### Steps

1. **Stock drop**：对比日环比/周环比 on-hand，超过阈值 σ 或 % 降幅触发；排除已知出库单。
2. **Sales spike**：对日销量用 robust z-score 或 STL residual；促销日历内降权或单独规则。
3. **Push failure**：聚合 ST-08 错误码频率、单客户失败率、连续失败 streak。
4. 合并去重：同一 SKU 多规则命中合并为 **incident**，附 severity。
5. 输出到告警渠道（邮件/钉钉/webhook）与 case 工单字段。

### Tools Used

- 时序存储、日志索引（ELK 等）
- 规则配置中心
- 可选：Isolation Forest / Prophet（若启用 ML）

### Constraints

- 降低 false positive：黑名单窗口、维护期 suppress。
- 所有告警须含 `evidence_window` 与可复现查询链接或 SQL 片段（内部）。

### Expected Output

- `incident_id`, `type`, `sku_id`, `severity`, `metrics`, `suggested_actions`。

### 关联 Skills

- 输入来自 **ST-08** 日志、**ST-10** 快照跳变、销售事实表；可触发 **ST-11** 提高审核强度。
- **ST-13** 日报附 Top incidents 摘要。

### 异常与降级

- 数据延迟导致假跌：对比 **ingestion_lag** 后再判责。
- 模型服务不可用：回退纯规则集，降低覆盖率但保持基本告警。

## 3. Prompt Injection

输出契约：覆盖 **stock drop**、**sales spike**、**push failure**，区分异常与促销/已知事件。数据缺失时不断言异常。
