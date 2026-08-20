---
name: st_10_inventory_sync
description: "查询 ARO 当前库存、批量库存和订单库存快照，解释库存数据状态；该 Skill 不触发外部库存同步，也不修改库存。"
---

# ST-10 库存同步（Inventory Snapshot Sync）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-10 库存同步 |
| **ID** | `ST-10` |
| **Category** | Data Integration / 数据集成 |
| **Layer** | ETL + Consistency |
| **Tags** | `DMS`, `snapshot`, `sync`, `ARO`, `reconciliation` |
| **Description** | 从 **DMS** 拉取或接收库存 **snapshot**，同步至 **ARO** 主存或缓存，支持全量与增量、水位线（high-watermark）及对账差异报告。 |

## 2. Execution Logic

### Steps

1. 触发：定时 cron、事件驱动（DMS webhook）、或手动 full refresh。
2. 拉取 snapshot：`sku_id`, `location_id`, `on_hand`, `available`, `in_transit`, `timestamp_dms`。
3. 映射到 ARO 主数据编码（cross-reference）；无法映射进入 **quarantine** 表。
4. Upsert 至 ARO inventory fact；记录 `sync_batch_id`, `source_ts`。
5. 对账：与上一快照或 ARO 事务账比对，输出 `delta_report`（超阈需人工）。

### Tools Used

- DMS API / SFTP / DB link
- ETL 作业编排
- 主数据匹配服务

### Constraints

- 时钟 skew：以 DMS `source_ts` 为准，冲突策略 configurable（last-write-wins / reject）。
- 大批量须分批 commit，避免长事务锁表。

### Expected Output

- `sync_batch_id`, `rows_upserted`, `rows_quarantined`, `max_source_ts`, `reconciliation_summary`。

### 关联 Skills

- **ST-03**、**ST-07**、**ST-09** 强依赖同步质量；**ST-12** 库存类 KPI 须标注 **snapshot_as_of**。
- **ST-15** 解释链中引用本次 sync 的 `batch_id` 便于对账。

### 异常与降级

- DMS 半日不可用：沿用上次快照并全局 **stale_inventory=true** 横幅提示。
- 大面积映射失败：暂停自动补货 job，仅允许查询模式。

## 3. Prompt Injection

输出契约：使用 **snapshot**、**sync**、**reconciliation** 术语说明 DMS→ARO 对账。不伪造 DMS 数据，假设必须标注。
