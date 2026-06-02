import asyncio

import pytest

from app.core.config import Settings
from app.schemas.knowledge_rag import HybridSearchRequest, SearchResultResponse
from app.services import knowledge_rag
from app.services import knowledge_rag_query_preprocessor
from app.services import knowledge_rag_reranker
from app.services.knowledge_rag import (
    _fuse_search_results,
    _score_keyword_candidate,
    build_search_context,
)


def test_score_keyword_candidate_prefers_title_and_content_phrase_matches() -> None:
    high = _score_keyword_candidate("budget", "budget report", "quarterly budget summary")
    low = _score_keyword_candidate("budget", "misc notes", "unrelated content")
    assert high > low
    assert high > 0.5


def test_score_keyword_candidate_avoids_single_character_score_inflation() -> None:
    assert _score_keyword_candidate("收", "收入报表", "收入情况说明") == 0.0


def test_build_search_context_limits_output() -> None:
    results = [
        SearchResultResponse(
            id="1",
            documentId="d1",
            documentTitle="Doc 1",
            content="a" * 100,
            parentChunkId="p1",
            parentContent="A" * 100,
            chunkIndex=0,
            score=0.8,
            source="keyword",
            sourceInfo=None,
        ),
        SearchResultResponse(
            id="2",
            documentId="d2",
            documentTitle="Doc 2",
            content="b" * 100,
            parentChunkId="p2",
            parentContent="B" * 100,
            chunkIndex=1,
            score=0.7,
            source="keyword",
            sourceInfo=None,
        ),
    ]
    context = build_search_context(results, max_chars=120)
    assert "[Doc 1]" in context
    assert "[Doc 2]" not in context


def test_build_search_context_deduplicates_shared_parent_context() -> None:
    results = [
        SearchResultResponse(
            id="1",
            documentId="d1",
            documentTitle="Doc 1",
            content="child-1",
            parentChunkId="parent-1",
            parentContent="shared parent context",
            chunkIndex=0,
            score=0.9,
            source="semantic",
            sourceInfo=None,
        ),
        SearchResultResponse(
            id="2",
            documentId="d1",
            documentTitle="Doc 1",
            content="child-2",
            parentChunkId="parent-1",
            parentContent="shared parent context",
            chunkIndex=1,
            score=0.8,
            source="semantic",
            sourceInfo=None,
        ),
    ]

    context = build_search_context(results, max_chars=200)
    assert context.count("[Doc 1]") == 1
    assert "shared parent context" in context


def test_fuse_search_results_marks_overlap_as_hybrid() -> None:
    semantic_results = [
        SearchResultResponse(
            id="shared",
            documentId="d1",
            documentTitle="Doc 1",
            content="semantic shared",
            chunkIndex=0,
            score=0.92,
            source="semantic",
            sourceInfo=None,
        ),
        SearchResultResponse(
            id="semantic-only",
            documentId="d2",
            documentTitle="Doc 2",
            content="semantic only",
            chunkIndex=1,
            score=0.81,
            source="semantic",
            sourceInfo=None,
        ),
    ]
    keyword_results = [
        SearchResultResponse(
            id="shared",
            documentId="d1",
            documentTitle="Doc 1",
            content="keyword shared",
            chunkIndex=0,
            score=0.77,
            source="keyword",
            sourceInfo=None,
        ),
        SearchResultResponse(
            id="keyword-only",
            documentId="d3",
            documentTitle="Doc 3",
            content="keyword only",
            chunkIndex=2,
            score=0.66,
            source="keyword",
            sourceInfo=None,
        ),
    ]

    fused = _fuse_search_results(semantic_results, keyword_results, fusion_weight=0.7, rrf_k=60)

    assert fused[0].id == "shared"
    assert fused[0].source == "hybrid"
    assert fused[0].score == 1.0
    assert {result.id for result in fused} == {"shared", "semantic-only", "keyword-only"}


def test_search_service_hybrid_combines_semantic_and_keyword(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_api_key="token",
        embedding_dimensions=2,
        embedding_version=3,
        search_rrf_k=60,
    )

    async def run() -> None:
        async def fake_keyword_search_chunks(session, user_id, filters):
            return [
                {
                    "id": "keyword-1",
                    "document_id": "doc-1",
                    "content": "budget execution report",
                    "chunk_index": 0,
                    "updated_at": 200,
                    "document_title": "Budget Report",
                    "source": "report.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                },
                {
                    "id": "shared",
                    "document_id": "doc-2",
                    "content": "cash flow budget",
                    "chunk_index": 1,
                    "updated_at": 100,
                    "document_title": "Cash Flow",
                    "source": "cash.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                },
            ]

        async def fake_semantic_search_chunks(session, user_id, *, embedding_vector, embedding_version, filters):
            assert embedding_vector == "[0.1,0.2]"
            assert embedding_version == 3
            return [
                {
                    "id": "shared",
                    "document_id": "doc-2",
                    "content": "cash flow budget",
                    "chunk_index": 1,
                    "updated_at": 100,
                    "document_title": "Cash Flow",
                    "source": "cash.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                    "score": 0.93,
                },
                {
                    "id": "semantic-1",
                    "document_id": "doc-3",
                    "content": "forecast planning",
                    "chunk_index": 2,
                    "updated_at": 300,
                    "document_title": "Forecast",
                    "source": "forecast.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                    "score": 0.88,
                },
            ]

        async def fake_embed_query(query, current_settings, runtime_config=None):
            assert query == "budget"
            assert current_settings.embedding_model == settings.embedding_model
            assert runtime_config is not None
            return [0.1, 0.2]

        monkeypatch.setattr(knowledge_rag, "keyword_search_chunks", fake_keyword_search_chunks)
        monkeypatch.setattr(knowledge_rag, "semantic_search_chunks", fake_semantic_search_chunks)
        monkeypatch.setattr(knowledge_rag, "embed_query", fake_embed_query)

        response = await knowledge_rag.search_service(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            payload=HybridSearchRequest(query="budget", mode="hybrid", limit=3, threshold=0.2),
            settings=settings,
        )

        assert [item.id for item in response.results] == ["keyword-1", "shared", "semantic-1"]
        assert next(item for item in response.results if item.id == "shared").source == "hybrid"
        assert response.semanticCount == 2
        assert response.keywordCount == 2
        assert response.queryEmbeddingTimeMs >= 0

    asyncio.run(run())


def test_search_service_query_preprocess_expands_queries_and_deduplicates(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_api_key="token",
        embedding_dimensions=2,
        embedding_version=3,
        search_rrf_k=60,
        query_preprocessor_enabled=True,
    )

    async def run() -> None:
        keyword_queries: list[str] = []
        semantic_queries: list[str] = []

        async def fake_preprocess_query(session, user_id, query, *, enable_expansion=False, enable_rewrite=True, settings=None):
            assert query == "预算执行分析"
            assert enable_expansion is True
            assert enable_rewrite is True
            return knowledge_rag_query_preprocessor.QueryPreprocessResult(
                original_query=query,
                expanded_queries=["预算执行分析", "财务预算执行"],
                preprocess_time_ms=12,
            )

        async def fake_keyword_search_chunks(session, user_id, filters):
            keyword_queries.append(filters["query"])
            if filters["query"] == "预算执行分析":
                return [
                    {
                        "id": "shared",
                        "document_id": "doc-1",
                        "content": "预算执行分析内容",
                        "chunk_index": 0,
                        "updated_at": 200,
                        "document_title": "预算报告",
                        "source": "report-a.pdf",
                        "publish_date": None,
                        "source_dept": "Finance",
                        "security_level": "internal",
                        "business_category": "planning",
                    }
                ]
            return [
                {
                    "id": "shared",
                    "document_id": "doc-1",
                    "content": "预算执行分析内容",
                    "chunk_index": 0,
                    "updated_at": 200,
                    "document_title": "预算报告",
                    "source": "report-a.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                },
                {
                    "id": "keyword-2",
                    "document_id": "doc-2",
                    "content": "财务预算执行说明",
                    "chunk_index": 1,
                    "updated_at": 100,
                    "document_title": "财务说明",
                    "source": "report-b.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                },
            ]

        async def fake_semantic_search_chunks(session, user_id, *, embedding_vector, embedding_version, filters):
            semantic_queries.append(filters["query"])
            if filters["query"] == "预算执行分析":
                return [
                    {
                        "id": "shared",
                        "document_id": "doc-1",
                        "content": "预算执行分析内容",
                        "chunk_index": 0,
                        "updated_at": 200,
                        "document_title": "预算报告",
                        "source": "report-a.pdf",
                        "publish_date": None,
                        "source_dept": "Finance",
                        "security_level": "internal",
                        "business_category": "planning",
                        "score": 0.94,
                    }
                ]
            return [
                {
                    "id": "semantic-2",
                    "document_id": "doc-3",
                    "content": "预算控制流程说明",
                    "chunk_index": 2,
                    "updated_at": 300,
                    "document_title": "流程说明",
                    "source": "report-c.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                    "score": 0.88,
                }
            ]

        async def fake_embed_query(query, current_settings, runtime_config=None):
            assert runtime_config is not None
            return [0.1, 0.2] if query == "预算执行分析" else [0.2, 0.1]

        monkeypatch.setattr(knowledge_rag, "preprocess_query", fake_preprocess_query)
        monkeypatch.setattr(knowledge_rag, "keyword_search_chunks", fake_keyword_search_chunks)
        monkeypatch.setattr(knowledge_rag, "semantic_search_chunks", fake_semantic_search_chunks)
        monkeypatch.setattr(knowledge_rag, "embed_query", fake_embed_query)

        response = await knowledge_rag.search_service(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            payload=HybridSearchRequest(
                query="预算执行分析",
                mode="hybrid",
                limit=5,
                threshold=0.2,
                enableQueryPreprocess=True,
                enableExpansion=True,
                enableRewrite=True,
            ),
            settings=settings,
        )

        assert keyword_queries == ["预算执行分析", "财务预算执行"]
        assert semantic_queries == ["预算执行分析", "财务预算执行"]
        assert {item.id for item in response.results} == {"shared", "keyword-2", "semantic-2"}
        assert response.semanticCount == 2
        assert response.keywordCount == 2
        assert response.preprocessTimeMs == 12

    asyncio.run(run())


def test_search_service_passes_only_supported_filters(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_api_key="token",
        embedding_dimensions=2,
        embedding_version=3,
    )

    async def run() -> None:
        seen_keyword_filters: list[dict] = []
        seen_semantic_filters: list[dict] = []

        async def fake_keyword_search_chunks(session, user_id, filters):
            seen_keyword_filters.append(filters)
            return []

        async def fake_semantic_search_chunks(session, user_id, *, embedding_vector, embedding_version, filters):
            seen_semantic_filters.append(filters)
            return []

        async def fake_embed_query(query, current_settings, runtime_config=None):
            return [0.1, 0.2]

        monkeypatch.setattr(knowledge_rag, "keyword_search_chunks", fake_keyword_search_chunks)
        monkeypatch.setattr(knowledge_rag, "semantic_search_chunks", fake_semantic_search_chunks)
        monkeypatch.setattr(knowledge_rag, "embed_query", fake_embed_query)

        await knowledge_rag.search_service(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            payload=HybridSearchRequest(
                query="budget",
                mode="hybrid",
                limit=5,
                threshold=0.4,
                fusionWeight=0.2,
                enableRerank=True,
                enableQueryPreprocess=False,
                documentIds=["doc-1"],
                tags=["finance"],
                sourceDept=["Finance"],
                securityLevel="internal",
                businessCategory=["planning"],
                publishDateRange={"start": "2026-01-01", "end": "2026-03-01"},
            ),
            settings=settings,
        )

        assert seen_keyword_filters == [
            {
                "tags": ["finance"],
                "documentIds": ["doc-1"],
                "limit": 5,
                "publishDateRange": {"start": "2026-01-01", "end": "2026-03-01"},
                "sourceDept": ["Finance"],
                "securityLevel": "internal",
                "businessCategory": ["planning"],
                "query": "budget",
            }
        ]
        assert seen_semantic_filters == seen_keyword_filters

    asyncio.run(run())


def test_search_service_mmr_reranks_diverse_results(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_api_key="token",
        embedding_dimensions=2,
        embedding_version=3,
        search_rrf_k=60,
        mmr_enabled=True,
        mmr_lambda=0.5,
        reranker_candidate_min=2,
        reranker_candidate_max=10,
    )

    async def run() -> None:
        async def fake_keyword_search_chunks(session, user_id, filters):
            return [
                {
                    "id": "a",
                    "document_id": "doc-a",
                    "content": "预算执行分析",
                    "chunk_index": 0,
                    "updated_at": 300,
                    "document_title": "预算报告A",
                    "source": "a.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                },
                {
                    "id": "b",
                    "document_id": "doc-b",
                    "content": "预算执行复盘",
                    "chunk_index": 1,
                    "updated_at": 200,
                    "document_title": "预算报告B",
                    "source": "b.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                },
                {
                    "id": "c",
                    "document_id": "doc-c",
                    "content": "控制流程说明",
                    "chunk_index": 2,
                    "updated_at": 100,
                    "document_title": "流程说明",
                    "source": "c.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                },
            ]

        async def fake_semantic_search_chunks(session, user_id, *, embedding_vector, embedding_version, filters):
            return [
                {
                    "id": "a",
                    "document_id": "doc-a",
                    "content": "预算执行分析",
                    "chunk_index": 0,
                    "updated_at": 300,
                    "document_title": "预算报告A",
                    "source": "a.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                    "score": 0.95,
                },
                {
                    "id": "b",
                    "document_id": "doc-b",
                    "content": "预算执行复盘",
                    "chunk_index": 1,
                    "updated_at": 200,
                    "document_title": "预算报告B",
                    "source": "b.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                    "score": 0.94,
                },
                {
                    "id": "c",
                    "document_id": "doc-c",
                    "content": "控制流程说明",
                    "chunk_index": 2,
                    "updated_at": 100,
                    "document_title": "流程说明",
                    "source": "c.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                    "score": 0.75,
                },
            ]

        async def fake_embed_query(query, current_settings, runtime_config=None):
            return [0.1, 0.2]

        async def fake_get_chunk_embeddings_batch(session, user_id, chunk_ids, *, embedding_version):
            assert chunk_ids == ["a", "b", "c"]
            assert embedding_version == 3
            return {
                "a": [1.0, 0.0],
                "b": [0.99, 0.01],
                "c": [0.0, 1.0],
            }

        monkeypatch.setattr(knowledge_rag, "keyword_search_chunks", fake_keyword_search_chunks)
        monkeypatch.setattr(knowledge_rag, "semantic_search_chunks", fake_semantic_search_chunks)
        monkeypatch.setattr(knowledge_rag, "embed_query", fake_embed_query)
        monkeypatch.setattr(knowledge_rag, "get_chunk_embeddings_batch", fake_get_chunk_embeddings_batch)

        response = await knowledge_rag.search_service(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            payload=HybridSearchRequest(
                query="预算执行",
                mode="hybrid",
                limit=3,
                threshold=0.2,
                enableMmr=True,
                mmrLambda=0.5,
            ),
            settings=settings,
        )

        assert [item.id for item in response.results] == ["a", "c", "b"]
        assert response.mmrTimeMs is not None
        assert response.semanticCount == 3
        assert response.keywordCount == 2

    asyncio.run(run())


def test_search_service_reranker_applies_threshold_and_source(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_api_key="token",
        embedding_dimensions=2,
        embedding_version=3,
        search_rrf_k=60,
        reranker_enabled=True,
        reranker_min_score=0.6,
        reranker_top_n=5,
        reranker_candidate_min=2,
        reranker_candidate_max=10,
    )

    async def run() -> None:
        async def fake_keyword_search_chunks(session, user_id, filters):
            return [
                {
                    "id": "a",
                    "document_id": "doc-a",
                    "content": "预算执行分析",
                    "chunk_index": 0,
                    "updated_at": 300,
                    "document_title": "预算报告A",
                    "source": "a.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                },
                {
                    "id": "b",
                    "document_id": "doc-b",
                    "content": "预算执行复盘",
                    "chunk_index": 1,
                    "updated_at": 200,
                    "document_title": "预算报告B",
                    "source": "b.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                },
            ]

        async def fake_semantic_search_chunks(session, user_id, *, embedding_vector, embedding_version, filters):
            return [
                {
                    "id": "a",
                    "document_id": "doc-a",
                    "content": "预算执行分析",
                    "chunk_index": 0,
                    "updated_at": 300,
                    "document_title": "预算报告A",
                    "source": "a.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                    "score": 0.95,
                },
                {
                    "id": "b",
                    "document_id": "doc-b",
                    "content": "预算执行复盘",
                    "chunk_index": 1,
                    "updated_at": 200,
                    "document_title": "预算报告B",
                    "source": "b.pdf",
                    "publish_date": None,
                    "source_dept": "Finance",
                    "security_level": "internal",
                    "business_category": "planning",
                    "score": 0.94,
                },
            ]

        async def fake_embed_query(query, current_settings, runtime_config=None):
            return [0.1, 0.2]

        async def fake_cross_encoder_rerank(session, user_id, query, results, *, top_n, settings=None):
            assert query == "预算执行"
            assert [item.id for item in results] == ["a", "b"]
            assert top_n == 3
            return knowledge_rag_reranker.RerankResult(
                results=[
                    results[1].model_copy(update={"score": 0.91, "source": "reranked"}),
                    results[0].model_copy(update={"score": 0.45, "source": "reranked"}),
                ],
                rerank_time_ms=8,
            )

        monkeypatch.setattr(knowledge_rag, "keyword_search_chunks", fake_keyword_search_chunks)
        monkeypatch.setattr(knowledge_rag, "semantic_search_chunks", fake_semantic_search_chunks)
        monkeypatch.setattr(knowledge_rag, "embed_query", fake_embed_query)
        monkeypatch.setattr(knowledge_rag, "cross_encoder_rerank", fake_cross_encoder_rerank)

        response = await knowledge_rag.search_service(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            payload=HybridSearchRequest(
                query="预算执行",
                mode="hybrid",
                limit=3,
                threshold=0.2,
                enableRerank=True,
                rerankerThreshold=0.6,
            ),
            settings=settings,
        )

        assert [item.id for item in response.results] == ["b"]
        assert response.results[0].source == "reranked"
        assert response.rerankTimeMs == 8

    asyncio.run(run())


def test_backfill_embeddings_service_uses_cache_and_deduplicates_embeddings(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_dimensions=2,
        embedding_version=3,
    )
    updates_seen: list[dict] = []
    cache_writes: list[tuple[str, str, str]] = []

    async def run() -> None:
        async def fake_find_document_by_id(session, user_id, document_id):
            assert document_id == "doc-1"
            return object()

        async def fake_get_chunks_without_embedding(session, user_id, document_id):
            return [
                {"id": "chunk-1", "content": "cached chunk", "content_hash": "hash-cached"},
                {"id": "chunk-2", "content": "new chunk", "content_hash": "hash-new"},
                {"id": "chunk-3", "content": "new chunk duplicate", "content_hash": "hash-new"},
            ]

        async def fake_resolve_embedding_runtime_config(session, user_id, current_settings):
            return knowledge_rag.EmbeddingRuntimeConfig(
                api_key="token",
                base_url="https://api.openai.com",
                model=current_settings.embedding_model,
                dimensions=current_settings.embedding_dimensions,
                timeout_ms=current_settings.embedding_timeout_ms,
                max_retries=current_settings.embedding_max_retries,
                headers={},
            )

        async def fake_find_embedding_cache_batch(session, user_id, content_hashes, embedding_model):
            assert content_hashes == ["hash-cached", "hash-new"]
            assert embedding_model == settings.embedding_model
            return {"hash-cached": "[0.9,0.8]"}

        async def fake_embed_chunk_batch(inputs, current_settings, runtime_config=None):
            assert [item.content_hash for item in inputs] == ["hash-new"]
            assert runtime_config is not None
            return [
                {
                    "chunkId": "chunk-2",
                    "contentHash": "hash-new",
                    "embedding": [0.1, 0.2],
                    "embeddingModel": current_settings.embedding_model,
                }
            ]

        async def fake_store_embedding_cache(session, user_id, *, content_hash, embedding_vector, embedding_model, expires_at):
            cache_writes.append((content_hash, embedding_vector, embedding_model))

        async def fake_update_chunk_embeddings_batch(session, user_id, updates):
            updates_seen.extend(updates)
            return len(updates)

        monkeypatch.setattr(knowledge_rag, "find_document_by_id", fake_find_document_by_id)
        monkeypatch.setattr(knowledge_rag, "get_chunks_without_embedding", fake_get_chunks_without_embedding)
        monkeypatch.setattr(
            knowledge_rag,
            "resolve_embedding_runtime_config",
            fake_resolve_embedding_runtime_config,
        )
        monkeypatch.setattr(knowledge_rag, "find_embedding_cache_batch", fake_find_embedding_cache_batch)
        monkeypatch.setattr(knowledge_rag, "embed_chunk_batch", fake_embed_chunk_batch)
        monkeypatch.setattr(knowledge_rag, "store_embedding_cache", fake_store_embedding_cache)
        monkeypatch.setattr(knowledge_rag, "update_chunk_embeddings_batch", fake_update_chunk_embeddings_batch)

        result = await knowledge_rag.backfill_embeddings_service(
            session=object(),
            user_id="00000000-0000-0000-0000-000000000001",
            document_id="doc-1",
            settings=settings,
        )

        assert result == {"count": 3}
        assert cache_writes == [("hash-new", "[0.1,0.2]", settings.embedding_model)]
        assert updates_seen == [
            {
                "chunkId": "chunk-1",
                "embeddingVector": "[0.9,0.8]",
                "embeddingModel": settings.embedding_model,
                "embeddingVersion": 3,
                "embeddingDimensions": 2,
            },
            {
                "chunkId": "chunk-2",
                "embeddingVector": "[0.1,0.2]",
                "embeddingModel": settings.embedding_model,
                "embeddingVersion": 3,
                "embeddingDimensions": 2,
            },
            {
                "chunkId": "chunk-3",
                "embeddingVector": "[0.1,0.2]",
                "embeddingModel": settings.embedding_model,
                "embeddingVersion": 3,
                "embeddingDimensions": 2,
            },
        ]

    asyncio.run(run())


def test_backfill_embeddings_service_requires_provider(monkeypatch) -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        embedding_dimensions=2,
    )

    async def run() -> None:
        async def fake_find_document_by_id(session, user_id, document_id):
            return object()

        async def fake_get_chunks_without_embedding(session, user_id, document_id):
            return [{"id": "chunk-1", "content": "needs embedding", "content_hash": "hash-1"}]

        async def fake_resolve_embedding_runtime_config(session, user_id, current_settings):
            return None

        monkeypatch.setattr(knowledge_rag, "find_document_by_id", fake_find_document_by_id)
        monkeypatch.setattr(knowledge_rag, "get_chunks_without_embedding", fake_get_chunks_without_embedding)
        monkeypatch.setattr(
            knowledge_rag,
            "resolve_embedding_runtime_config",
            fake_resolve_embedding_runtime_config,
        )

        with pytest.raises(RuntimeError, match="Embedding provider is not configured"):
            await knowledge_rag.backfill_embeddings_service(
                session=object(),
                user_id="00000000-0000-0000-0000-000000000001",
                document_id="doc-1",
                settings=settings,
            )

    asyncio.run(run())
