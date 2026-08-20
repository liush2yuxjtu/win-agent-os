### 品线ID查询（动态查表，必用）

> ⚠️ **品线ID（PROD_ID）必须通过查询 `video_management.dbo.QC_MONTAGE_PRODUCT` 表动态获取，不要硬编码或猜测品线ID。** 该表直接包含 PROD_ID、品线名、基线ROI、基线日消耗等完整信息。

**查询所有启用品线**（获取品线列表和PROD_ID）：

```sql
SELECT PROD_ID, PROD_NAME, ROI_QUALIFIED_BASELINE, DAILY_SPEND_BASELINE
FROM video_management.dbo.QC_MONTAGE_PRODUCT
WHERE ROI_QUALIFIED_BASELINE IS NOT NULL
  AND STATE = '1'
ORDER BY PROD_ID
```

**按品线名模糊查询**（用户提到品线名时，用此查询匹配PROD_ID）：

```sql
SELECT PROD_ID, PROD_NAME, ROI_QUALIFIED_BASELINE, DAILY_SPEND_BASELINE
FROM video_management.dbo.QC_MONTAGE_PRODUCT
WHERE PROD_NAME LIKE N'%{品线关键词}%'
  AND ROI_QUALIFIED_BASELINE IS NOT NULL
  AND STATE = '1'
```

> **使用流程**：用户提到品线名（如"桃桃"、"护舒宝"等）→ 执行上述模糊查询 → 拿到 PROD_ID 和基线ROI → 再用查询1获取该品线素材列表。
> `QC_MONTAGE_PRODUCT` 表字段说明：PROD_ID（品线ID，主键）、PROD_NAME（品线名称）、BRAND_ID（品牌ID）、ROI_QUALIFIED_BASELINE（ROI合格基线）、DAILY_SPEND_BASELINE（日消耗基线）、STATE（状态：0=停用/1=启用）。

## 核心查询

### 查询1: 获取品线下的素材列表（标准SQL，必用）

这是提取品线素材的**标准SQL**，将 `{PROD_ID}` 替换为品线ID（如好奇桃桃=1）。素材级直接走 `VIDEO_PROD_TAG → MATERIAL_VIDEO_DATA`，**不经过CUT切片表**：

```sql
SELECT D.ID, D.ADVERTISER_ID, D.MATERIAL_ID, D.FILENAME, D.V_ID, D.CREATE_TIME
FROM video_management.dbo.QC_MONTAGE_MATERIAL_VIDEO_DATA D
INNER JOIN video_management.dbo.QC_MONTAGE_VIDEO_PROD_TAG VPT
    ON D.ID = VPT.VIDEO_ID
WHERE VPT.PROD_ID = {PROD_ID}
  AND VPT.STATE = '1'
```

> ⚠️ **必须使用此SQL提取品线素材**，不能简化或替换。`QC_MONTAGE_VIDEO_PROD_TAG.VIDEO_ID` 指向 `QC_MONTAGE_MATERIAL_VIDEO_DATA.ID`（混剪内部素材行ID，非千川MATERIAL_ID）。
> ⚠️ **不要用 `QC_MONTAGE_CUT_UNIQUE`**——那是唯一切片表（切片级去重），粒度是切片不是素材，且其ROI/TOTAL_SPEND是切片级汇总，不是素材级原始指标。

### 查询1.5: 获取品线素材对应的千川MATERIAL_ID（关键桥接）

品线素材(`MATERIAL_VIDEO_DATA`)和千川投放数据(`千川素材数据_素材列表`)通过 `(ADVERTISER_ID, MATERIAL_ID)` 业务键直接关联：

```sql
SELECT DISTINCT D.ADVERTISER_ID, D.MATERIAL_ID, D.FILENAME
FROM video_management.dbo.QC_MONTAGE_MATERIAL_VIDEO_DATA D
INNER JOIN video_management.dbo.QC_MONTAGE_VIDEO_PROD_TAG VPT
    ON D.ID = VPT.VIDEO_ID
WHERE VPT.PROD_ID = {PROD_ID}
  AND VPT.STATE = '1'
```

> 关联链路：`VIDEO_PROD_TAG.VIDEO_ID` = `MATERIAL_VIDEO_DATA.ID` →（拿 ADVERTISER_ID + MATERIAL_ID）→ `千川素材数据_素材列表.ADVERTISER_ID + MATERIAL_ID`
> 两表 MATERIAL_ID 均为 numeric 类型，类型一致，关联无需CAST。
> ⚠️ **不需要经过 V_ID 桥接或 CUT 表**。`MATERIAL_VIDEO_DATA.ADVERTISER_ID + MATERIAL_ID` 就是千川平台素材的业务键，直接与 `千川素材数据_素材列表` 对齐。
