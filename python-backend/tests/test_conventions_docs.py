from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_root_docs_keep_multi_format_rag_positioning() -> None:
    root_readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    backend_readme = (REPO_ROOT / "python-backend" / "README.md").read_text(encoding="utf-8")
    ocr_readme = (REPO_ROOT / "ocr-service" / "README.md").read_text(encoding="utf-8")

    assert "PDF、Markdown、TXT" in root_readme
    assert "large files" in backend_readme
    assert "扫描件或文本层质量过低的文件触发 OCR" in ocr_readme


def test_root_docs_keep_frontend_structure_guidance() -> None:
    root_readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    assert "src/features/<domain>" in root_readme
    assert "src/shared/" in root_readme
    assert "src/lib/" in root_readme


def test_root_docs_explain_root_navigation_and_local_artifacts() -> None:
    root_readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    agents_doc = (REPO_ROOT / "AGENTS.md").read_text(encoding="utf-8")
    codex_readme = (REPO_ROOT / ".Codex" / "README.md").read_text(encoding="utf-8")
    gitignore = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8")

    assert "## 根目录导航" in root_readme
    assert "核心业务目录" in root_readme
    assert "项目级 AI 协作目录" in root_readme
    assert "本地产物目录" in root_readme
    assert ".Codex/" in root_readme
    assert ".claude/" in root_readme
    assert "当前项目级 AI 协作主目录是 `.Codex/`" in agents_doc
    assert "`.claude/`、`.agents/` 视为历史或并存工具目录" in agents_doc
    assert "规范以仓库根 `AGENTS.md` 和 `.Codex/` 下的治理文档为准" in agents_doc
    assert "`.Codex/` 是当前项目级 AI 协作主目录" in codex_readme
    assert "单一事实来源" in codex_readme
    assert ".Codex/" not in gitignore
    assert "docs/" not in gitignore


def test_legacy_claude_docs_stay_as_compatibility_mirrors() -> None:
    claude_agents = (REPO_ROOT / ".claude" / "AGENTS.md").read_text(encoding="utf-8")
    claude_doc = (REPO_ROOT / ".claude" / "CLAUDE.md").read_text(encoding="utf-8")
    claude_release_skill = (REPO_ROOT / ".claude" / "skills" / "release" / "SKILL.md").read_text(encoding="utf-8")
    codex_release_skill = (REPO_ROOT / ".Codex" / "skills" / "release" / "SKILL.md").read_text(encoding="utf-8")

    assert "兼容目录" in claude_agents
    assert "src/features/<domain>/" in claude_agents
    assert ".Codex/plans/" in claude_agents
    assert ".Codex/skills/" in claude_agents
    assert "compatibility mirror" in claude_doc
    assert "src/features/<domain>/" in claude_doc
    assert "app.services.knowledge_rag_public" in claude_doc
    assert "当前项目级 AI 协作主目录是 `.Codex/`" in claude_doc
    assert "`.Codex/` 是 gitignored" not in codex_release_skill
    assert "`.Codex/` 永远不入库" not in codex_release_skill
    assert "`.claude/` 永远不入库" not in claude_release_skill
    assert "新的约定、plan、skill 默认进入根 `AGENTS.md` 或 `.Codex/`" in claude_release_skill


def test_gitignore_covers_known_local_artifacts() -> None:
    gitignore = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8")

    for entry in (
        "node_modules/",
        "dist/",
        "dist-frontend-tests/",
        ".venv/",
        "__pycache__/",
        ".pytest_cache/",
        ".ruff_cache/",
        ".tmp/",
    ):
        assert entry in gitignore


def test_docs_keep_runtime_ports_and_commands_consistent() -> None:
    root_readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    backend_readme = (REPO_ROOT / "python-backend" / "README.md").read_text(encoding="utf-8")
    ocr_readme = (REPO_ROOT / "ocr-service" / "README.md").read_text(encoding="utf-8")

    assert "http://127.0.0.1:3266" in root_readme
    assert "http://127.0.0.1:8787" in root_readme
    assert "http://127.0.0.1:8001" in root_readme
    assert "--port 8787" in backend_readme
    assert "--port 8001" in ocr_readme
    assert "npm ci" in root_readme
    assert "uv sync --default-index https://pypi.org/simple --package table-ocr-service" in ocr_readme


def test_docs_do_not_publish_removed_projection_outbox_runtime_knobs() -> None:
    root_readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")

    assert "PROJECTION_OUTBOX_POLL_MS" not in root_readme
    assert "PROJECTION_OUTBOX_BATCH_SIZE" not in root_readme
    assert "PROJECTION_OUTBOX_POLL_MS" not in env_example
    assert "PROJECTION_OUTBOX_BATCH_SIZE" not in env_example


def test_codex_architecture_debt_register_tracks_known_structure_debt() -> None:
    debt_doc = (REPO_ROOT / ".Codex" / "architecture-debt.md").read_text(encoding="utf-8")

    assert "agent/__init__.py" in debt_doc
    assert "knowledge_rag.py" in debt_doc
    assert "当前剩余调用方" in debt_doc
    assert "settings/public.ts" in debt_doc
    assert "vendor" in debt_doc
    assert "chart-vendor" in debt_doc
    assert "tracked debt" in debt_doc
