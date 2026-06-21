import asyncio
from collections import OrderedDict
from types import SimpleNamespace

import app.services.knowledge_rag_embeddings as knowledge_rag_embeddings
from app.core.config import Settings
from app.services.knowledge_rag_embeddings import (
    EmbeddingChunkInput,
    EmbeddingRuntimeConfig,
    embed_chunk_batch,
    embed_query,
    format_vector_for_db,
    resolve_embedding_runtime_config,
    validate_embedding_dimensions,
)


def test_format_vector_for_db_serializes_pgvector() -> None:
    assert format_vector_for_db([0.1, 0.2, 0.3]) == "[0.1,0.2,0.3]"


def test_validate_embedding_dimensions_checks_expected_size() -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_dimensions=3,
    )
    validate_embedding_dimensions([0.1, 0.2, 0.3], settings)


def test_embed_query_uses_in_memory_cache(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_api_key="token",
        embedding_dimensions=2,
    )
    calls: list[str] = []
    knowledge_rag_embeddings._QUERY_EMBEDDING_CACHE.clear()

    async def run() -> None:
        async def fake_embed(self, inputs):
            calls.append(inputs[0])
            return [[0.1, 0.2]]

        monkeypatch.setattr(knowledge_rag_embeddings.OpenAICompatibleEmbeddingClient, "embed", fake_embed)

        runtime_config = EmbeddingRuntimeConfig(
            api_key="token",
            base_url="https://api.openai.com",
            model=settings.embedding_model,
            dimensions=2,
            timeout_ms=settings.embedding_timeout_ms,
            max_retries=settings.embedding_max_retries,
            headers={},
        )

        first = await embed_query("budget", settings, runtime_config=runtime_config)
        second = await embed_query("budget", settings, runtime_config=runtime_config)

        assert first == [0.1, 0.2]
        assert second == [0.1, 0.2]
        assert calls == ["budget"]

    asyncio.run(run())


def test_query_embedding_cache_evicts_oldest_entry_when_capacity_exceeded(monkeypatch) -> None:
    knowledge_rag_embeddings._QUERY_EMBEDDING_CACHE = OrderedDict()
    monkeypatch.setattr(knowledge_rag_embeddings, "QUERY_EMBEDDING_CACHE_MAX_ITEMS", 2)

    knowledge_rag_embeddings.set_cached_query_embedding("first", "model-a", [0.1, 0.2])
    knowledge_rag_embeddings.set_cached_query_embedding("second", "model-a", [0.2, 0.3])
    knowledge_rag_embeddings.set_cached_query_embedding("third", "model-a", [0.3, 0.4])

    assert knowledge_rag_embeddings.get_cached_query_embedding("first", "model-a") is None
    assert knowledge_rag_embeddings.get_cached_query_embedding("second", "model-a") == [0.2, 0.3]
    assert knowledge_rag_embeddings.get_cached_query_embedding("third", "model-a") == [0.3, 0.4]


def test_embed_chunk_batch_maps_embedding_payload(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_api_key="token",
        embedding_dimensions=2,
    )

    async def run() -> None:
        async def fake_embed(self, inputs):
            assert inputs == ["chunk one", "chunk two"]
            return [[0.1, 0.2], [0.3, 0.4]]

        monkeypatch.setattr(knowledge_rag_embeddings.OpenAICompatibleEmbeddingClient, "embed", fake_embed)
        runtime_config = EmbeddingRuntimeConfig(
            api_key="token",
            base_url="https://api.openai.com",
            model=settings.embedding_model,
            dimensions=2,
            timeout_ms=settings.embedding_timeout_ms,
            max_retries=settings.embedding_max_retries,
            headers={},
        )

        results = await embed_chunk_batch(
            [
                EmbeddingChunkInput(chunk_id="c1", content_hash="h1", content="chunk one"),
                EmbeddingChunkInput(chunk_id="c2", content_hash="h2", content="chunk two"),
            ],
            settings,
            runtime_config=runtime_config,
        )

        assert results == [
            {
                "chunkId": "c1",
                "contentHash": "h1",
                "embedding": [0.1, 0.2],
                "embeddingModel": settings.embedding_model,
            },
            {
                "chunkId": "c2",
                "contentHash": "h2",
                "embedding": [0.3, 0.4],
                "embeddingModel": settings.embedding_model,
            },
        ]

    asyncio.run(run())


def test_embed_chunk_batch_splits_large_requests(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_api_key="token",
        embedding_dimensions=2,
    )
    calls: list[list[str]] = []

    async def run() -> None:
        async def fake_embed(self, inputs):
            calls.append(inputs)
            return [[0.1, 0.2] for _ in inputs]

        monkeypatch.setattr(knowledge_rag_embeddings.OpenAICompatibleEmbeddingClient, "embed", fake_embed)
        monkeypatch.setattr(knowledge_rag_embeddings, "EMBEDDING_BATCH_MAX_INPUTS", 2)
        monkeypatch.setattr(knowledge_rag_embeddings, "EMBEDDING_BATCH_MAX_CHARS", 1000)

        runtime_config = EmbeddingRuntimeConfig(
            api_key="token",
            base_url="https://api.openai.com",
            model=settings.embedding_model,
            dimensions=2,
            timeout_ms=settings.embedding_timeout_ms,
            max_retries=settings.embedding_max_retries,
            headers={},
        )

        results = await embed_chunk_batch(
            [
                EmbeddingChunkInput(chunk_id="c1", content_hash="h1", content="a" * 400),
                EmbeddingChunkInput(chunk_id="c2", content_hash="h2", content="b" * 400),
                EmbeddingChunkInput(chunk_id="c3", content_hash="h3", content="c" * 400),
            ],
            settings,
            runtime_config=runtime_config,
        )

        assert len(calls) == 2
        assert calls[0] == ["a" * 400, "b" * 400]
        assert calls[1] == ["c" * 400]
        assert [item["chunkId"] for item in results] == ["c1", "c2", "c3"]

    asyncio.run(run())


def test_resolve_embedding_runtime_config_falls_back_to_active_provider(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_dimensions=2,
        provider_secret_key="table-dev-provider-secret-key-change-me",
    )

    async def run() -> None:
        provider = SimpleNamespace(
            api_format="openai",
            api_key_encrypted="provider-secret",
            base_url="https://provider.example.com/",
            embedding_model="text-embedding-provider",
            headers_json={"X-Test": "1", "Ignored": 2},
        )

        async def fake_find_active_provider_for_user(session, user_id):
            return provider

        monkeypatch.setattr(
            knowledge_rag_embeddings,
            "find_active_provider_for_user",
            fake_find_active_provider_for_user,
        )
        monkeypatch.setattr(
            knowledge_rag_embeddings,
            "decrypt_provider_secret",
            lambda value, current: "provider-secret",
        )

        config = await resolve_embedding_runtime_config(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            settings=settings,
        )

        assert config is not None
        assert config.api_key == "provider-secret"
        assert config.base_url == "https://provider.example.com"
        assert config.model == "text-embedding-provider"
        assert config.dimensions is None
        assert config.headers == {"X-Test": "1"}

    asyncio.run(run())
