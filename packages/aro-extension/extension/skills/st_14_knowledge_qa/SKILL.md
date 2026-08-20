---
name: st_14_knowledge_qa
description: "基于 ARO 知识图谱回答不依赖客户运行数据的概念、术语、字段和通用流程问题，可搜索实体、查询类层级或查看图谱子图；不查询或修改客户业务数据。指定 SKU 的 ABC 分类、分类算法依据或实际计算过程应使用 ABC 分类 Skill。"
---

# ST-14 知识问答（Ontology-Based Q&A）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-14 知识问答 |
| **ID** | `ST-14` |
| **Category** | Knowledge / 知识服务 |
| **Layer** | RAG + Ontology |
| **Tags** | `ontology`, `Q&A`, `supply-chain`, `glossary`, `ARO` |
| **Description** | 基于 ARO **supply chain ontology**（实体、关系、属性、约束）回答概念性问题：如 ATP、cross-dock、allotment、SLOG、AO 与 KPI 定义，引用版本化术语表，避免与业务配置冲突。 |

## 2. Execution Logic

### Steps

1. 识别知识任务类型：定义查询、流程说明、对比、计算口径。
2. 检索 ontology 片段：class、property、axiom、example instances（若索引可用）。
3. 组装答案：先给简短定义，再给关系图式说明（文字化），标注 **ontology version**。
4. 若问题涉及运行数据，提示转交 ST-12/ST-03 等执行 skill，不混答虚构数。
5. 记录反馈 thumbs 用于词表迭代（可选）。

### Tools Used

- `search_ontology`：按关键词搜索实体
- `get_class_hierarchy`：查询类层级
- `query_ontology_graph`：按实体查询子图，或查看结构化图谱
- 向量检索（可选）+ 重排序

### Constraints

- 禁止将未在 ontology 中出现的缩写当作事实；须标注 **推断** 或 **待确认**。
- 多语言回答时术语首次出现中英并列。

### Expected Output

- 自然语言答复 + `references[]`（class URI 或 doc section）+ `ontology_version`。

### 关联 Skills

- 与 **ST-15** 互补：本 skill 偏静态概念，**ST-15** 偏个案 trace；**ST-12** KPI 名称以本体为准可减少歧义。
- **ST-17** 用户混淆指标定义时，可先经本 skill 对齐术语再仿真。

### 异常与降级

- 检索无命中：返回 **clarifying questions** 列表，不猜测组织私有含义。
- ontology 版本冲突：提示用户指定 `ontology_version` 再答。

## 3. Prompt Injection

输出契约：优先引用 ARO **ontology** 的定义与关系，保留英文术语原文。检索无结果时明确标注未知，不编造 KPI 公式。
