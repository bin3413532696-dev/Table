import asyncio

from app.core.config import Settings
from app.services.knowledge_rag_query_preprocessor import (
    QueryExpansionRuntimeConfig,
    multi_query_expansion,
    preprocess_query,
    rewrite_query,
)
from app.services import knowledge_rag_query_preprocessor


def test_rewrite_query_removes_common_stopwords() -> None:
    assert rewrite_query("请 问 预算 执行 怎么 管理") == "预算 执行 管理"


def test_rewrite_query_falls_back_to_original_when_empty() -> None:
    assert rewrite_query("请 问 怎么") == "请 问 怎么"


def test_multi_query_expansion_falls_back_to_original_when_provider_missing(monkeypatch) -> None:
    settings = Settings(database_url="postgresql://user:pass@localhost:5432/table")

    async def run() -> None:
        async def fake_resolve_query_expansion_runtime_config(session, user_id, current_settings):
            return None

        monkeypatch.setattr(
            knowledge_rag_query_preprocessor,
            "resolve_query_expansion_runtime_config",
            fake_resolve_query_expansion_runtime_config,
        )

        result = await multi_query_expansion(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            query="预算执行分析",
            expand_count=3,
            settings=settings,
        )

        assert result.original_query == "预算执行分析"
        assert result.expanded_queries == ["预算执行分析"]
        assert result.preprocess_time_ms >= 0

    asyncio.run(run())


def test_preprocess_query_rewrite_and_expansion(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        query_expansion_count=3,
    )

    async def run() -> None:
        async def fake_multi_query_expansion(session, user_id, query, *, expand_count, settings=None, runtime_config=None):
            assert query == "预算 执行 管理"
            assert expand_count == 3
            return knowledge_rag_query_preprocessor.QueryPreprocessResult(
                original_query=query,
                expanded_queries=["预算 执行 管理", "财务预算执行", "预算控制流程"],
                preprocess_time_ms=7,
            )

        monkeypatch.setattr(
            knowledge_rag_query_preprocessor,
            "multi_query_expansion",
            fake_multi_query_expansion,
        )

        result = await preprocess_query(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            query="请 预算 执行 管理",
            enable_expansion=True,
            enable_rewrite=True,
            settings=settings,
        )

        assert result.original_query == "请 预算 执行 管理"
        assert result.expanded_queries == ["预算 执行 管理", "财务预算执行", "预算控制流程"]
        assert result.preprocess_time_ms >= 0

    asyncio.run(run())


def test_multi_query_expansion_parses_chat_output(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        query_preprocessor_timeout_ms=5000,
    )

    async def run() -> None:
        async def fake_complete(self, *, system_prompt, user_prompt):
            assert "生成 2 个语义相关但表述不同的查询变体" in system_prompt
            assert "原始查询" in user_prompt
            return "财务预算执行\n预算控制流程\n财务预算执行"

        monkeypatch.setattr(
            knowledge_rag_query_preprocessor,
            "resolve_query_expansion_runtime_config",
            lambda session, user_id, settings=None: asyncio.sleep(
                0,
                result=QueryExpansionRuntimeConfig(
                    api_key="token",
                    base_url="https://provider.example.com",
                    model="gpt-4o-mini",
                    timeout_ms=5000,
                    headers={},
                ),
            ),
        )
        monkeypatch.setattr(
            knowledge_rag_query_preprocessor.OpenAICompatibleChatClient,
            "complete",
            fake_complete,
        )

        result = await multi_query_expansion(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            query="预算执行管理",
            expand_count=2,
            settings=settings,
        )

        assert result.expanded_queries == ["预算执行管理", "财务预算执行", "预算控制流程"]

    asyncio.run(run())
