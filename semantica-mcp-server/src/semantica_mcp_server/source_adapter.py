from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

PARSER_VERSION = "qc-markdown-v1"
_SECTION_RE = re.compile(r"^##\s+\d+\.\s+(.+)$")


@dataclass(frozen=True)
class SourceEntry:
    name: str
    sha256: str
    path: Path


@dataclass
class FieldFragment:
    name: str
    type: str = ""
    nullable: bool = False
    primary_key: bool = False
    chinese_name: str = ""
    description: str = ""
    sample: str = ""
    enum: dict[str, str] = field(default_factory=dict)


@dataclass
class TableFragment:
    source_file: str
    source_sha256: str
    table: str
    chinese_name: str
    database: str
    schema: str
    description: str
    metadata: dict[str, str]
    fields: list[FieldFragment]
    relations: list[dict[str, str]]
    known_issues: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TableFragment":
        return cls(
            source_file=str(data["source_file"]),
            source_sha256=str(data["source_sha256"]),
            table=str(data["table"]),
            chinese_name=str(data.get("chinese_name", "")),
            database=str(data.get("database", "video_management")),
            schema=str(data.get("schema", "dbo")),
            description=str(data.get("description", "")),
            metadata={str(k): str(v) for k, v in data.get("metadata", {}).items()},
            fields=[FieldFragment(**field) for field in data.get("fields", [])],
            relations=[{str(k): str(v) for k, v in rel.items()} for rel in data.get("relations", [])],
            known_issues=[str(item) for item in data.get("known_issues", [])],
        )


def _contained(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def load_manifest(raw_dir: Path) -> tuple[list[SourceEntry], str]:
    root = raw_dir.resolve()
    checksum_path = root / "SHA256SUMS"
    entries: list[SourceEntry] = []
    for line_number, raw_line in enumerate(checksum_path.read_text("utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split(maxsplit=1)
        if len(parts) != 2 or not re.fullmatch(r"[0-9a-fA-F]{64}", parts[0]):
            raise ValueError(f"SHA256SUMS 第 {line_number} 行格式非法")
        name = parts[1].lstrip("*").strip()
        if Path(name).name != name or not name.endswith(".md"):
            raise ValueError("SHA256SUMS 只能包含 raw_files 根目录下的 Markdown")
        path = root / name
        if not _contained(root, path) or not path.is_file() or path.is_symlink():
            raise ValueError(f"清单文件缺失或路径非法: {name}")
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        expected = parts[0].lower()
        if actual != expected:
            raise ValueError(f"文件完整性校验失败: {name}")
        # DB.md 是本地连接说明/凭据容器，不属于数据字典，绝不摄取。
        if name == "DB.md":
            continue
        entries.append(SourceEntry(name=name, sha256=expected, path=path))
    entries.sort(key=lambda item: item.name)
    if not entries:
        raise ValueError("SHA256SUMS 未列出可摄取的 Markdown")
    digest = hashlib.sha256()
    for entry in entries:
        digest.update(f"{entry.sha256}  {entry.name}\n".encode("utf-8"))
    return entries, digest.hexdigest()


def _split_row(line: str) -> list[str]:
    cells = [cell.strip().strip("`") for cell in line.strip().strip("|").split("|")]
    return cells


def _table_rows(lines: list[str]) -> list[list[str]]:
    table_lines = [line for line in lines if line.strip().startswith("|")]
    if len(table_lines) < 2:
        return []
    rows: list[list[str]] = []
    separator_seen = False
    for line in table_lines[1:]:
        if not separator_seen and re.fullmatch(r"\s*\|?[\s:|-]+\|?\s*", line):
            separator_seen = True
            continue
        if separator_seen:
            rows.append(_split_row(line))
    return rows


def _sections(lines: list[str]) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines:
        match = _SECTION_RE.match(line)
        if match:
            current = match.group(1).strip()
            sections[current] = []
        elif current is not None:
            sections[current].append(line)
    return sections


def _section(sections: dict[str, list[str]], prefix: str) -> list[str]:
    for name, lines in sections.items():
        if name.startswith(prefix):
            return lines
    return []


def parse_source(entry: SourceEntry) -> TableFragment | None:
    text = entry.path.read_text("utf-8")
    lines = text.splitlines()
    if not lines or not lines[0].startswith("# "):
        return None
    title = lines[0][2:].strip()
    title_parts = [part.strip() for part in title.split("·", 1)]
    table = title_parts[0]
    if table == "DB":
        return None
    chinese_name = title_parts[1] if len(title_parts) > 1 else ""
    db_match = re.search(
        r"\*\*数据库 \(Database\):\*\*\s*`([^`]+)`\s*·\s*\*\*Schema:\*\*\s*`([^`]+)`",
        text,
    )
    database = db_match.group(1) if db_match else "video_management"
    schema = db_match.group(2) if db_match else "dbo"
    section_map = _sections(lines)

    metadata: dict[str, str] = {}
    for row in _table_rows(_section(section_map, "表元数据")):
        if len(row) >= 2 and row[0] and row[1] not in {"—", "-"}:
            key = re.sub(r"\s*\(.*\)$", "", row[0]).strip()
            metadata[key] = row[1].strip()

    fields: dict[str, FieldFragment] = {}
    for row in _table_rows(_section(section_map, "Schema")):
        if len(row) < 2 or not row[0]:
            continue
        fields[row[0]] = FieldFragment(
            name=row[0],
            type=row[1],
            nullable=len(row) > 2 and "是" in row[2],
            primary_key=len(row) > 3 and "是" in row[3],
        )
    for row in _table_rows(_section(section_map, "字段定义")):
        if not row or not row[0]:
            continue
        current = fields.setdefault(row[0], FieldFragment(name=row[0]))
        if len(row) > 1:
            current.chinese_name = row[1]
        if len(row) > 2:
            current.description = row[2]
        if len(row) > 4:
            current.sample = row[4]

    enum_lines = _section(section_map, "枚举字典")
    current_field: str | None = None
    in_code = False
    for line in enum_lines:
        heading = re.match(r"^###\s+`([^`]+)`", line)
        if heading:
            current_field = heading.group(1)
            fields.setdefault(current_field, FieldFragment(name=current_field))
            continue
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if current_field and in_code and "=" in line:
            key, value = line.split("=", 1)
            fields[current_field].enum[key.strip()] = value.strip()

    relations: list[dict[str, str]] = []
    current_relation: dict[str, str] | None = None
    for line in _section(section_map, "表关系"):
        match = re.match(r"^\s*→\s*(.+?)\s*(?:\(([^)]*)\))?\s*$", line)
        if match:
            target = match.group(1).strip()
            if target != "—":
                current_relation = {"target": target}
                if match.group(2):
                    current_relation["cardinality"] = match.group(2).strip()
                relations.append(current_relation)
            continue
        join = re.match(r"^\s*Join Key:\s*(.+)$", line)
        if join and current_relation is not None:
            current_relation["join_key"] = join.group(1).strip()

    known_issues = [
        re.sub(r"^[-*]\s+", "", line).strip()
        for line in _section(section_map, "已知问题")
        if re.match(r"^\s*[-*]\s+", line)
    ]
    description = metadata.get("解释") or metadata.get("Description") or ""
    return TableFragment(
        source_file=entry.name,
        source_sha256=entry.sha256,
        table=table,
        chinese_name=chinese_name,
        database=database,
        schema=schema,
        description=description,
        metadata=metadata,
        fields=sorted(fields.values(), key=lambda field: field.name),
        relations=relations,
        known_issues=known_issues,
    )
