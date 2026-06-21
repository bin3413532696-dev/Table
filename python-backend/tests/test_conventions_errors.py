from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_standard_error_helpers_remain_consistent() -> None:
    error_mapping = (REPO_ROOT / "python-backend" / "app" / "api" / "error_mapping.py").read_text(encoding="utf-8")
    assert '"error": "NOT_FOUND"' in error_mapping
    assert '"error": "CONFLICT"' in error_mapping
    assert '"error": "BAD_REQUEST"' in error_mapping
    assert '"error": code, "message": message' in error_mapping


def test_route_modules_use_standard_http_error_helpers() -> None:
    for route_name in (
        "agent.py",
        "auth.py",
        "finance.py",
        "knowledge.py",
        "knowledge_rag.py",
        "providers.py",
        "tasks.py",
    ):
        source = (REPO_ROOT / "python-backend" / "app" / "api" / "routes" / route_name).read_text(encoding="utf-8")
        assert "from app.api.error_mapping import " in source
        assert 'detail={"error": "NOT_FOUND"' not in source
