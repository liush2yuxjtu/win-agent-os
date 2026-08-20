from semantica_mcp_server.config import Config
from semantica_mcp_server.service import SemanticaService
from semantica_mcp_server.state import StateStore


def test_sync_is_idempotent(raw_dir, tmp_path):
    config = Config(raw_dir, tmp_path / "state", "127.0.0.1", 7333, None)
    service = SemanticaService(config)
    first = service.sync()
    second = service.sync()
    assert first["changed"] is True
    assert second["changed"] is False
    assert first["generation"] == second["generation"]
    assert service.graph.summary()["source_count"] == 2
    results = service.graph.search("品线", ["Table", "Field"], 10)
    assert results


def test_dry_run_does_not_create_generation(raw_dir, tmp_path):
    config = Config(raw_dir, tmp_path / "state", "127.0.0.1", 7333, None)
    service = SemanticaService(config)
    result = service.sync(dry_run=True)
    assert result["status"] == "dry_run"
    assert service.status()["active_generation"] is None


def test_sync_lock_is_cross_process_safe(tmp_path):
    state_dir = tmp_path / "state"
    first = StateStore(state_dir)
    second = StateStore(state_dir)
    with first.sync_lock() as first_acquired:
        assert first_acquired is True
        with second.sync_lock() as second_acquired:
            assert second_acquired is False
