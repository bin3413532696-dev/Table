import asyncio
from types import SimpleNamespace

from app.core.config import Settings
from app.schemas.knowledge_rag import SearchResultResponse
from app.services import knowledge_rag_reranker
from app.services.knowledge_rag_reranker import (
    RerankerRuntimeConfig,
    cross_encoder_rerank,
    estimate_tokens,
    truncate_by_tokens,
)


def _result(result_id: str, score: float = 0.8) -> SearchResultResponse:
    return SearchResultResponse(
        id=result_id,
        documentId=f"doc-{result_id}",
        documentTitle=f"Doc {result_id}",
        content="预算执行分析内容" * 20,
        chunkIndex=0,
        score=score,
        source="hybrid",
        sourceInfo=None,
    )


def test_estimate_tokens_handles_mixed_text() -> None:
    assert estimate_tokens("预算 plan") > 0


def test_truncate_by_tokens_limits_long_text() -> None:
    text = "预算执行分析内容" * 100
    truncated = truncate_by_tokens(text, 20)
    assert len(truncated) < len(text)
    assert estimate_tokens(truncated) <= 20


def test_cross_encoder_rerank_falls_back_when_provider_missing(monkeypatch) -> None:
    settings = Settings(database_url="postgresql://user:pass@localhost:5432/table")

    async def run() -> None:
        async def fake_resolve_reranker_runtime_config(session, user_id, settings=None):
            return None

        monkeypatch.setattr(
            knowledge_rag_reranker,
            "resolve_reranker_runtime_config",
            fake_resolve_reranker_runtime_config,
        )

        result = await cross_encoder_rerank(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            query="预算执行",
            results=[_result("a"), _result("b")],
            top_n=1,
            settings=settings,
        )

        assert [item.id for item in result.results] == ["a"]
        assert result.rerank_time_ms >= 0

    asyncio.run(run())


def test_cross_encoder_rerank_applies_remote_scores(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        reranker_timeout_ms=5000,
        reranker_max_tokens=100,
    )

    async def run() -> None:
        async def fake_resolve_reranker_runtime_config(session, user_id, settings=None):
            return RerankerRuntimeConfig(
                api_key="token",
                base_url="https://provider.example.com",
                model="rerank-v1",
                timeout_ms=5000,
                headers={},
                max_tokens=100,
            )

        async def fake_rerank(self, *, query, documents, top_n):
            assert query == "预算执行"
            assert top_n == 2
            assert len(documents) == 2
            return [
                {"index": 1, "relevance_score": 0.92},
                {"index": 0, "relevance_score": 0.55},
            ]

        monkeypatch.setattr(
            knowledge_rag_reranker,
            "resolve_reranker_runtime_config",
            fake_resolve_reranker_runtime_config,
        )
        monkeypatch.setattr(
            knowledge_rag_reranker.OpenAICompatibleRerankerClient,
            "rerank",
            fake_rerank,
        )

        result = await cross_encoder_rerank(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            query="预算执行",
            results=[_result("a"), _result("b")],
            top_n=2,
            settings=settings,
        )

        assert [item.id for item in result.results] == ["b", "a"]
        assert result.results[0].source == "reranked"
        assert result.rerank_time_ms >= 0

    asyncio.run(run())


def test_resolve_reranker_runtime_config_uses_active_provider(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        provider_secret_key="table-dev-provider-secret-key-change-me",
    )

    async def run() -> None:
        provider = SimpleNamespace(
            api_key_encrypted="provider-secret",
            base_url="https://provider.example.com/",
            reranker_model="rerank-v3",
            headers_json={"X-Test": "1", "Ignored": 2},
        )

        async def fake_find_active_provider_for_user(session, user_id):
            return provider

        monkeypatch.setattr(
            knowledge_rag_reranker,
            "find_active_provider_for_user",
            fake_find_active_provider_for_user,
        )
        monkeypatch.setattr(
            knowledge_rag_reranker,
            "decrypt_provider_secret",
            lambda value, current: "provider-secret",
        )

        config = await knowledge_rag_reranker.resolve_reranker_runtime_config(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            settings=settings,
        )

        assert config is not None
        assert config.api_key == "provider-secret"
        assert config.base_url == "https://provider.example.com"
        assert config.model == "rerank-v3"
        assert config.headers == {"X-Test": "1"}

    asyncio.run(run())
