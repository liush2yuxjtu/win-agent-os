---
name: st_08_order_push
description: "查询 ARO 建议订单的推送状态、采购订单回传结果和失败原因。当前工具只读，不通过对话直接向 DMS 推送订单。"
---

# ST-08 订单推送（Order Push to DMS）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-08 订单推送 |
| **ID** | `ST-08` |
| **Category** | Integration / 集成 |
| **Layer** | Workflow + API |
| **Tags** | `DMS`, `push`, `status-tracking`, `idempotency`, `webhook` |
| **Description** | 将 ARO 侧已审核订单 **push** 至 **DMS（Dealer Management System 或下游分销系统）**，维护端到端 **status tracking**（queued/sent/accepted/rejected），支持重试与幂等键。 |

## 2. Execution Logic

### Steps

1. 校验订单状态：仅 `approved` 或 policy 允许的状态可推送。
2. 组装 DMS payload（JSON/XML）：行项目、价格、ship-to、reference `aro_order_id`。
3. 调用 DMS API，携带 `Idempotency-Key`；记录 request/response 原文（脱敏）。
4. 解析回调或轮询：更新 `dms_status`, `dms_order_no`, `error_code`。
5. 失败分支：指数退避重试、DLQ、人工介入队列；成功则触发 ST-10 相关同步若需要。

### Tools Used

- HTTP client、签名/认证模块
- `query_purchase_orders`：只读查询已形成的采购订单及可选明细
- 消息队列（可选）
- 审计存储

### Constraints

- 同一 `aro_order_id` 重复推送不得产生重复 DMS 单（依赖 idempotency）。
- PII 与价格敏感字段按合规脱敏日志。

### Expected Output

- 推送结果实体：`push_id`, `status`, `dms_order_no`, `last_error`, `timeline[]`。

### 关联 Skills

- 上游 **ST-11** 审核通过方可推送；**ST-09** 监控 **push failure**；**ST-10** 可在 DMS 确认后拉库存。
- **ST-13** 报表可汇总推送成功率与延迟。

### 异常与降级

- DMS 429/503：退避重试 + **circuit breaker** 防止雪崩。
- 部分行被拒：拆分成功子单并记录失败行供人工修正。

## 3. Prompt Injection

输出契约：覆盖 **DMS**、**status tracking** 和 **idempotency**；状态枚举保留英文。不模拟真实 API 响应。
