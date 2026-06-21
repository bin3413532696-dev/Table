from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

AGENT_PUBLIC_EXPORTS = {
    "confirm_agent_tool_record",
    "create_agent_run_record",
    "create_agent_session_record",
    "delete_agent_run_record",
    "delete_agent_session_memory_record",
    "delete_agent_session_record",
    "get_agent_capabilities",
    "get_agent_persona",
    "get_agent_run_detail",
    "get_agent_run_list",
    "get_agent_runtime_status",
    "get_agent_session_detail",
    "get_agent_session_list",
    "get_agent_session_memory_record",
    "reject_agent_tool_record",
    "stream_agent_run_record",
    "stream_confirm_agent_tool_record",
    "stream_reject_agent_tool_record",
    "update_agent_persona_record",
    "update_agent_run_record",
    "update_agent_session_memory_settings_record",
    "update_agent_session_record",
}

KNOWLEDGE_RAG_PUBLIC_EXPORTS = {
    "DocumentQualityError",
    "IndexJobActiveError",
    "backfill_embeddings_service",
    "build_search_context",
    "create_corpus_service",
    "delete_corpus_service",
    "delete_document_service",
    "get_chunks",
    "get_corpora",
    "get_corpus",
    "get_document",
    "get_documents",
    "get_job",
    "get_jobs",
    "get_ocr_health",
    "get_stats",
    "resolve_corpus_document_ids",
    "search_service",
    "search_with_context_service",
    "trigger_index_service",
    "update_corpus_service",
    "update_document_service",
    "upload_document_service",
}


def _parse_dunder_all_exports(source: str) -> set[str]:
    exports: set[str] = set()
    in_all_block = False

    for raw_line in source.splitlines():
        line = raw_line.strip()
        if line == "__all__ = [":
            in_all_block = True
            continue
        if in_all_block and line == "]":
            break
        if in_all_block and line.startswith('"'):
            exports.add(line.strip('",'))

    return exports


def test_knowledge_rag_services_do_not_use_string_key_dependency_containers() -> None:
    service_paths = [
        REPO_ROOT / "python-backend" / "app" / "services" / "knowledge_rag.py",
        REPO_ROOT / "python-backend" / "app" / "services" / "knowledge_rag_write.py",
        REPO_ROOT / "python-backend" / "app" / "services" / "knowledge_rag_mutations.py",
        REPO_ROOT / "python-backend" / "app" / "services" / "knowledge_rag_tasks.py",
        REPO_ROOT / "python-backend" / "app" / "services" / "knowledge_rag_embedding_support.py",
        REPO_ROOT / "python-backend" / "app" / "services" / "knowledge_rag_ingest.py",
        REPO_ROOT / "python-backend" / "app" / "services" / "knowledge_rag_images.py",
    ]

    for path in service_paths:
        source = path.read_text(encoding="utf-8")
        assert "deps: dict[str, Any]" not in source
        assert "resolved_deps[" not in source
        assert 'deps["' not in source


def test_agent_services_do_not_use_runtime_importlib_compat() -> None:
    agent_dir = REPO_ROOT / "python-backend" / "app" / "services" / "agent"
    for path in agent_dir.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "importlib.import_module" not in source
        assert "_agent_compat(" not in source
        assert "_public_compat(" not in source
        assert "_memory_compat(" not in source


def test_agent_state_persistence_does_not_route_repository_updates_through_package_root() -> None:
    source = (REPO_ROOT / "python-backend" / "app" / "services" / "agent" / "_state_persistence.py").read_text(
        encoding="utf-8"
    )
    assert "from app.services import agent as agent_service" not in source
    assert "await agent_runtime_support.update_agent_run(" in source


def test_agent_internal_modules_import_private_helpers_via_direct_submodules() -> None:
    state_source = (REPO_ROOT / "python-backend" / "app" / "services" / "agent" / "_state_persistence.py").read_text(
        encoding="utf-8"
    )
    tools_source = (REPO_ROOT / "python-backend" / "app" / "services" / "agent" / "_tools.py").read_text(
        encoding="utf-8"
    )
    assert "from app.services.agent import _runtime_support as agent_runtime_support" not in state_source
    assert "from app.services.agent import _tool_prompting" not in tools_source


def test_agent_public_is_the_runtime_facade_for_routes() -> None:
    route_source = (REPO_ROOT / "python-backend" / "app" / "api" / "routes" / "agent.py").read_text(encoding="utf-8")
    assert "from app.services.agent.public import (" in route_source

    package_source = (REPO_ROOT / "python-backend" / "app" / "services" / "agent" / "__init__.py").read_text(
        encoding="utf-8"
    )
    public_source = (REPO_ROOT / "python-backend" / "app" / "services" / "agent" / "public.py").read_text(
        encoding="utf-8"
    )
    assert "importlib.import_module" not in package_source
    assert "sys.modules[__name__].__class__" not in package_source
    assert "from app.services.agent._execution import stream_agent_run_record" not in route_source
    assert "_build_effective_system_prompt" not in public_source
    assert "_execute_agent_tool_call" not in public_source
    assert "_execute_pending_confirmation_tool" not in public_source
    assert "build_metadata_event" not in public_source
    assert "resolve_runtime_config_for_user" not in public_source
    assert _parse_dunder_all_exports(public_source) == AGENT_PUBLIC_EXPORTS


def test_agent_provider_runtime_does_not_use_package_root_stream_overrides() -> None:
    source = (REPO_ROOT / "python-backend" / "app" / "services" / "agent" / "_provider_runtime.py").read_text(
        encoding="utf-8"
    )
    assert "_resolve_stream_override" not in source
    assert "_stream_exported_handler" not in source


def test_knowledge_rag_public_does_not_export_repository_style_helpers() -> None:
    source = (REPO_ROOT / "python-backend" / "app" / "services" / "knowledge_rag_public.py").read_text(
        encoding="utf-8"
    )
    assert "get_chunk_by_id" not in source
    assert "from app.services.knowledge_rag_errors import DocumentQualityError, IndexJobActiveError" in source
    assert "from app.services.knowledge_rag import (" not in source
    assert _parse_dunder_all_exports(source) == KNOWLEDGE_RAG_PUBLIC_EXPORTS


def test_agent_package_root_freezes_private_compat_exports() -> None:
    source = (REPO_ROOT / "python-backend" / "app" / "services" / "agent" / "__init__.py").read_text(encoding="utf-8")
    allowed_private_exports = {
        "_build_effective_system_prompt",
        "_build_pending_confirmation_tool",
        "_build_run_detail_from_state",
        "_execute_agent_tool_call",
        "_execute_pending_confirmation_tool",
        "_extract_anthropic_stream_delta_text",
        "_extract_gemini_stream_delta_text",
        "_extract_stream_delta_text",
        "_parse_tool_calls",
        "_stream_anthropic_messages",
        "_stream_gemini_generate_content",
        "_stream_openai_chat_completion",
        "_stream_provider_chat_completion",
        "_supported_agent_tool_names",
        "_to_agent_run_detail",
    }

    private_exports = {
        line.strip().strip('",')
        for line in source.splitlines()
        if line.strip().startswith('"_"') is False and line.strip().startswith("_") and line.strip() != "__all__ = ["
    }

    assert private_exports == allowed_private_exports


def test_knowledge_rag_module_freezes_compat_surface() -> None:
    source = (REPO_ROOT / "python-backend" / "app" / "services" / "knowledge_rag.py").read_text(encoding="utf-8")
    assert "OCRServiceClient = knowledge_rag_ingest_service.OCRServiceClient" in source
    assert "_score_keyword_candidate = knowledge_rag_query_support_service._score_keyword_candidate" in source
    assert "_fuse_search_results = knowledge_rag_query_support_service._fuse_search_results" in source
    assert source.count("= knowledge_rag_") <= 4


def test_route_modules_do_not_import_private_agent_or_rag_modules() -> None:
    routes_dir = REPO_ROOT / "python-backend" / "app" / "api" / "routes"
    for path in routes_dir.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "from app.services.agent._" not in source
        assert (
            "from app.services.knowledge_rag_" not in source
            or "from app.services.knowledge_rag_public import" in source
        )


def test_knowledge_rag_service_uses_explicit_submodule_imports() -> None:
    source = (REPO_ROOT / "python-backend" / "app" / "services" / "knowledge_rag.py").read_text(encoding="utf-8")
    assert "from app.services import knowledge_rag_query as" not in source
    assert "from app.services import knowledge_rag_embedding_support as" not in source
    assert "from app.services import knowledge_rag_ingest as" not in source
    assert "from app.services import knowledge_rag_images as" not in source
    assert "from app.services import knowledge_rag_mutations as" not in source
    assert "from app.services import knowledge_rag_tasks as" not in source
    assert "from app.services import knowledge_rag_write as" not in source


def test_selected_agent_tests_patch_concrete_modules_instead_of_package_root() -> None:
    for test_name in (
        "agent_stream_test_helpers.py",
        "test_agent_registry.py",
        "test_agent_rag_tools.py",
        "test_agent_stream_confirmations.py",
        "test_agent_stream_execution.py",
        "test_agent_stream_service.py",
    ):
        source = (REPO_ROOT / "python-backend" / "tests" / test_name).read_text(encoding="utf-8")
        assert "from app.services import agent as agent_service" not in source
        assert "from app.services.agent import _" not in source
        assert "monkeypatch.setattr(agent_service," not in source
        assert "agent_service." not in source


def test_agent_stream_service_stays_out_of_execution_flow_tests() -> None:
    source = (REPO_ROOT / "python-backend" / "tests" / "test_agent_stream_service.py").read_text(encoding="utf-8")
    assert "from app.services.agent import _execution as agent_execution" not in source
    assert "agent_execution.stream_agent_run_record(" not in source


def test_selected_knowledge_rag_tests_do_not_default_to_compat_facade() -> None:
    for test_name in (
        "test_knowledge_rag_describe_phase.py",
        "test_knowledge_rag_search.py",
        "test_knowledge_rag_services.py",
        "test_knowledge_rag_integration.py",
    ):
        source = (REPO_ROOT / "python-backend" / "tests" / test_name).read_text(encoding="utf-8")
        assert "import app.services.knowledge_rag as knowledge_rag" not in source
        assert "from app.services.knowledge_rag import (" not in source
