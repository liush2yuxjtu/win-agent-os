from __future__ import annotations

import hashlib
from pathlib import Path

import pytest


DOC = """# QC_TEST_PRODUCT · 测试品线表

> **数据库 (Database):** `video_management` · **Schema:** `dbo`

## 1. 表元数据

| 属性 | 值 |
| --- | --- |
| 解释 | 测试品线主数据 |
| 业务域 | 素材 |
| 主键 | PROD_ID |

## 2. Schema

| 字段 | 类型 | 可空 | 主键 |
| --- | --- | --- | --- |
| PROD_ID | bigint | 否 | 是 |
| STATUS | int | 否 | 否 |

## 3. 样例数据

| 字段 | 中文名 | 样例 |
| --- | --- | --- |
| PROD_ID | 品线 ID | 100 |

## 4. 数据画像

—

## 5. 表关系

→ QC_TEST_EDGE (1:N)
Join Key: PROD_ID

## 6. 数据血缘

—

## 7. 字段定义

| 字段 | 中文名 | 说明 | 来源 | 样例 | 规则 | 备注 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PROD_ID | 品线 ID | 主键 | — | 100 | — | — | 有效 |
| STATUS | 状态 | 启停状态 | — | 1 | — | — | 有效 |

## 8. 枚举字典

### `STATUS` · 状态

```
1 = 启用
2 = 停用
```

## 9. 已知问题

- **STATUS**：历史值可能为空

## 10. 常见用法

按品线关联。
"""

EDGE_DOC = DOC.replace("QC_TEST_PRODUCT · 测试品线表", "QC_TEST_EDGE · 测试边表").replace("→ QC_TEST_EDGE (1:N)\nJoin Key: PROD_ID", "—")


@pytest.fixture
def raw_dir(tmp_path: Path) -> Path:
    raw = tmp_path / "raw_files"
    raw.mkdir()
    files = {"QC_TEST_PRODUCT.md": DOC, "QC_TEST_EDGE.md": EDGE_DOC}
    checksums = []
    for name, content in files.items():
        path = raw / name
        path.write_text(content, "utf-8")
        checksums.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {name}")
    (raw / "SHA256SUMS").write_text("\n".join(checksums) + "\n", "utf-8")
    return raw
