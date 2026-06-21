from pathlib import Path

from app.api.constants import HEALTH_CHECK_PATH
from app.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_route_modules_keep_business_prefixes_outside_api_root() -> None:
    routes_dir = REPO_ROOT / "python-backend" / "app" / "api" / "routes"
    expected_prefixes = {
        "agent.py": 'prefix="/agent"',
        "auth.py": 'prefix="/auth"',
        "finance.py": 'prefix="/finance"',
        "knowledge.py": 'prefix="/knowledge"',
        "knowledge_rag.py": 'prefix="/knowledge-rag"',
        "maintenance.py": 'prefix="/maintenance"',
        "providers.py": 'prefix="/providers"',
        "tasks.py": 'prefix="/tasks"',
    }

    for path in routes_dir.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert 'prefix="/api' not in source
        expected_prefix = expected_prefixes.get(path.name)
        if expected_prefix is not None:
            assert expected_prefix in source
        if path.name == "health.py":
            assert "prefix=HEALTH_ROUTE_PREFIX" in source


def test_api_router_owns_api_root_prefix_once() -> None:
    source = (REPO_ROOT / "python-backend" / "app" / "api" / "router.py").read_text(encoding="utf-8")
    assert "APIRouter(prefix=API_ROOT_PREFIX)" in source
    assert 'include_router(health_router, prefix="/api/health"' not in source
    assert 'include_router(auth_router, prefix="/api"' not in source


def test_openapi_contains_expected_api_paths() -> None:
    app = create_app()
    paths = app.openapi()["paths"]

    for path in (HEALTH_CHECK_PATH, "/api/auth/me", "/api/tasks/", "/api/knowledge-rag/stats", "/api/agent/health"):
        assert path in paths


def test_health_path_constant_is_used_by_middleware() -> None:
    source = (REPO_ROOT / "python-backend" / "app" / "main.py").read_text(encoding="utf-8")
    assert 'startswith(HEALTH_CHECK_PATH)' in source
