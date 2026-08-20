from semantica_mcp_server.pipeline import build_snapshot
from semantica_mcp_server.source_adapter import load_manifest, parse_source


def test_parse_and_build_graph(raw_dir):
    entries, corpus_sha = load_manifest(raw_dir)
    fragments = [parse_source(entry) for entry in entries]
    fragments = [fragment for fragment in fragments if fragment]
    product = next(fragment for fragment in fragments if fragment.table == "QC_TEST_PRODUCT")
    assert product.description == "测试品线主数据"
    assert product.fields[0].name == "PROD_ID"
    assert next(field for field in product.fields if field.name == "STATUS").enum == {"1": "启用", "2": "停用"}
    snapshot = build_snapshot(fragments, corpus_sha, "0.6.5")
    assert any(node.type == "Table" and node.metadata["table"] == "QC_TEST_PRODUCT" for node in snapshot.nodes)
    assert any(edge.type == "RELATES_TO" for edge in snapshot.edges)
    assert all(edge.source and edge.target for edge in snapshot.edges)


def test_checksum_failure(raw_dir):
    (raw_dir / "QC_TEST_PRODUCT.md").write_text("tampered", "utf-8")
    try:
        load_manifest(raw_dir)
    except ValueError as exc:
        assert "完整性校验失败" in str(exc)
    else:
        raise AssertionError("tampered file should fail")
