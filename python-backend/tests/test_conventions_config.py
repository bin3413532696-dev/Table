from importlib.metadata import version
from pathlib import Path

from app.core.config import Settings
from app.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_default_backend_port_matches_documentation() -> None:
    settings = Settings.model_construct(server_port=8787)
    assert settings.server_port == 8787

    root_readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    backend_readme = (REPO_ROOT / "python-backend" / "README.md").read_text(encoding="utf-8")

    assert "http://127.0.0.1:8787" in root_readme
    assert "--port 8787" in backend_readme


def test_settings_accept_server_port_compat_aliases() -> None:
    settings = Settings(
        DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/table_dev",
        SERVER_PORT=9001,
    )
    assert settings.server_port == 9001

    py_settings = Settings(
        DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/table_dev",
        PYTHON_SERVER_PORT=9002,
    )
    assert py_settings.server_port == 9002


def test_documented_env_defaults_match_settings_defaults() -> None:
    env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")

    assert "ALLOW_DEFAULT_USER_FALLBACK=false" in env_example
    assert "PROVIDER_SECRET_KEY=table-dev-provider-secret-key-change-me" in env_example
    assert "PROJECTION_OUTBOX_POLL_MS" not in env_example
    assert "| `ALLOW_DEFAULT_USER_FALLBACK` | 允许未登录时回退到默认用户 | `false` |" in readme
    assert (
        "| `PROVIDER_SECRET_KEY` | 会话签名密钥（**生产环境务必更换**） | "
        "`table-dev-provider-secret-key-change-me` |" in readme
    )
    assert "PostgreSQL 正在监听 `127.0.0.1:5432`" in readme
    assert "数据库已启用 `pgvector` 扩展" in readme
    assert "PROJECTION_OUTBOX_POLL_MS" not in readme


def test_openapi_version_comes_from_python_package_metadata() -> None:
    app = create_app()
    assert app.version == version("table-python-backend")


def test_readme_and_contributing_document_layered_test_commands() -> None:
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    contributing = (REPO_ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")

    for command in [
        "npm run backend:test:unit",
        "npm run backend:test:integration",
        "npm run backend:test:startup",
        "npm run backend:test:conventions",
        "npm run backend:test:ci",
        "npm run ocr:test",
        "npm run smoke:basic",
    ]:
        assert command in readme

    assert "后端分层测试通过：`npm run backend:test:ci`" in contributing
    assert "OCR 测试通过：`npm run ocr:test`" in contributing
