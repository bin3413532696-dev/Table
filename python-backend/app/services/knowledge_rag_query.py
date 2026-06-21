from __future__ import annotations

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.integrations.ocr_service import OCRServiceClient, OCRServiceSettings
from app.repositories.knowledge_corpora import find_corpus_by_id, list_corpora, list_corpus_document_links
from app.repositories.knowledge_rag import (
    find_document_by_id,
    find_job_by_id,
    get_chunk_embeddings_batch,
    get_rag_stats,
    keyword_search_chunks,
    list_chunks_with_count,
    list_documents_with_count,
    list_jobs_with_count,
    semantic_search_chunks,
)
from app.schemas.knowledge_rag import (
    ChunkListQuery,
    DocumentListQuery,
    IndexJobResponse,
    JobListQuery,
    KnowledgeChunkResponse,
    KnowledgeCorpusResponse,
    KnowledgeDocumentResponse,
    OCRHealthResponse,
    RagStatsResponse,
    SearchResponse,
    SearchResultResponse,
)
from app.services.knowledge_rag_embeddings import (
    embed_query,
    format_vector_for_db,
    resolve_embedding_runtime_config,
)
from app.services.knowledge_rag_mmr import mmr_rerank
from app.services.knowledge_rag_query_preprocessor import preprocess_query
from app.services.knowledge_rag_query_support import (
    _deduplicate_results,
    _extract_search_filters,
    _fuse_search_results,
    _keyword_results_from_rows,
    _semantic_results_from_rows,
    build_search_context,
    to_chunk_response,
    to_corpus_response,
    to_document_response,
    to_job_response,
)
from app.services.knowledge_rag_reranker import cross_encoder_rerank


async def get_documents(
    session: AsyncSession,
    user_id: str,
    query: DocumentListQuery,
) -> tuple[list[KnowledgeDocumentResponse], int]:
    documents, total = await list_documents_with_count(session, user_id, query.model_dump(exclude_none=True))
    links = await list_corpus_document_links(session, user_id)
    corpus_ids_by_document: dict[str, list[str]] = {}
    for link in links:
        corpus_ids_by_document.setdefault(str(link.document_id), []).append(str(link.corpus_id))

    items: list[KnowledgeDocumentResponse] = []
    for document in documents:
        item = to_document_response(document)
        item.corpusIds = corpus_ids_by_document.get(str(document.id), [])
        items.append(item)
    return items, total


async def get_document(session: AsyncSession, user_id: str, document_id: str) -> KnowledgeDocumentResponse | None:
    document = await find_document_by_id(session, user_id, document_id)
    if not document:
        return None
    item = to_document_response(document)
    links = await list_corpus_document_links(session, user_id, document_id=document_id)
    item.corpusIds = [str(link.corpus_id) for link in links]
    return item


async def get_corpora(session: AsyncSession, user_id: str) -> tuple[list[KnowledgeCorpusResponse], int]:
    corpora = await list_corpora(session, user_id)
    links = await list_corpus_document_links(session, user_id)
    document_ids_by_corpus: dict[str, list[str]] = {}
    for link in links:
        document_ids_by_corpus.setdefault(str(link.corpus_id), []).append(str(link.document_id))
    items = [to_corpus_response(corpus, document_ids_by_corpus.get(str(corpus.id), [])) for corpus in corpora]
    return items, len(items)


async def get_corpus(session: AsyncSession, user_id: str, corpus_id: str) -> KnowledgeCorpusResponse | None:
    corpus = await find_corpus_by_id(session, user_id, corpus_id)
    if not corpus:
        return None
    links = await list_corpus_document_links(session, user_id, corpus_id=corpus_id)
    return to_corpus_response(corpus, [str(link.document_id) for link in links])


async def resolve_corpus_document_ids(
    session: AsyncSession,
    user_id: str,
    *,
    corpus_id: str | None,
) -> list[str]:
    if not corpus_id:
        return []
    links = await list_corpus_document_links(session, user_id, corpus_id=corpus_id)
    return [str(link.document_id) for link in links]


async def get_jobs(session: AsyncSession, user_id: str, query: JobListQuery) -> tuple[list[IndexJobResponse], int]:
    jobs, total = await list_jobs_with_count(session, user_id, query.model_dump(exclude_none=True))
    return [to_job_response(job) for job in jobs], total


async def get_job(session: AsyncSession, user_id: str, job_id: str) -> IndexJobResponse | None:
    job = await find_job_by_id(session, user_id, job_id)
    return to_job_response(job) if job else None


async def get_chunks(
    session: AsyncSession,
    user_id: str,
    query: ChunkListQuery,
) -> tuple[list[KnowledgeChunkResponse], int]:
    rows, total = await list_chunks_with_count(session, user_id, query.documentId, query.limit, query.offset)
    return [to_chunk_response(row) for row in rows], total


async def get_stats(session: AsyncSession, user_id: str) -> RagStatsResponse:
    return RagStatsResponse(**(await get_rag_stats(session, user_id)))


async def get_ocr_health(settings: Settings | None = None) -> OCRHealthResponse:
    current = settings or get_settings()
    client = OCRServiceClient(
        OCRServiceSettings(
            service_url=current.ocr_service_url,
            enabled=current.ocr_enabled,
            timeout_ms=current.ocr_timeout_ms,
        )
    )
    return OCRHealthResponse(
        enabled=current.ocr_enabled,
        available=await client.is_available(),
        serviceUrl=current.ocr_service_url,
    )


async def search_service(
    session: AsyncSession,
    user_id: str,
    payload,
    settings: Settings | None = None,
) -> SearchResponse:
    started_at = datetime.now()
    current = settings or get_settings()
    base_filters = _extract_search_filters(payload)
    query = (payload.query or "").strip()
    query_embedding_time_ms = 0
    preprocess_time_ms = 0
    mmr_time_ms = 0
    rerank_time_ms = 0
    preprocess_ran = False
    mmr_ran = False
    rerank_ran = False
    queries_to_search = [query] if query else []

    if payload.enableQueryPreprocess and current.query_preprocessor_enabled and query:
        preprocess_ran = True
        preprocess_result = await preprocess_query(
            session,
            user_id,
            query,
            enable_expansion=payload.enableExpansion,
            enable_rewrite=(
                payload.enableRewrite
                if payload.enableRewrite is not None
                else current.query_rewrite_enabled
            ),
            settings=current,
        )
        queries_to_search = preprocess_result.expanded_queries
        preprocess_time_ms = preprocess_result.preprocess_time_ms

    keyword_results: list[SearchResultResponse] = []
    if payload.mode in {"keyword", "hybrid"}:
        keyword_source = "hybrid" if payload.mode == "hybrid" else "keyword"
        for current_query in queries_to_search or [query]:
            current_filters = {**base_filters, "query": current_query}
            keyword_rows = await keyword_search_chunks(session, user_id, current_filters)
            keyword_results.extend(
                _keyword_results_from_rows(keyword_rows, current_query, payload.threshold, keyword_source)
            )
        keyword_results = _deduplicate_results(keyword_results)

    semantic_results: list[SearchResultResponse] = []
    runtime_config = None
    should_run_semantic = payload.mode in {"semantic", "hybrid"} and bool(query.strip())
    if should_run_semantic:
        runtime_config = await resolve_embedding_runtime_config(session, user_id, current)
    if runtime_config is not None:
        semantic_source = "hybrid" if payload.mode == "hybrid" else "semantic"
        for current_query in queries_to_search or [query]:
            if not current_query.strip():
                continue
            query_embedding_started_at = datetime.now()
            embedding = await embed_query(current_query, current, runtime_config=runtime_config)
            query_embedding_time_ms += max(int((datetime.now() - query_embedding_started_at).total_seconds() * 1000), 0)
            semantic_rows = await semantic_search_chunks(
                session,
                user_id,
                embedding_vector=format_vector_for_db(embedding),
                embedding_version=current.embedding_version,
                filters={**base_filters, "query": current_query},
            )
            semantic_results.extend(_semantic_results_from_rows(semantic_rows, payload.threshold, semantic_source))
        semantic_results = _deduplicate_results(semantic_results)

    if payload.mode == "semantic":
        ranked_results = semantic_results
    elif payload.mode == "hybrid":
        ranked_results = _fuse_search_results(
            semantic_results,
            keyword_results,
            fusion_weight=payload.fusionWeight,
            rrf_k=current.search_rrf_k,
        )
    else:
        ranked_results = keyword_results

    results = ranked_results[: payload.limit]
    should_run_mmr = payload.enableMmr and current.mmr_enabled and bool(query) and bool(ranked_results)
    if should_run_mmr:
        mmr_ran = True
        candidate_limit = min(
            max(current.reranker_candidate_min, payload.limit * 5),
            current.reranker_candidate_max,
        )
        candidate_results = ranked_results[:candidate_limit]
        chunk_ids = [item.id for item in candidate_results]
        mmr_started_at = datetime.now()
        embeddings = await get_chunk_embeddings_batch(
            session,
            user_id,
            chunk_ids,
            embedding_version=current.embedding_version,
        )
        mmr_top_k = candidate_limit if payload.enableRerank and current.reranker_enabled else payload.limit
        results = mmr_rerank(
            candidate_results,
            embeddings,
            lambda_weight=payload.mmrLambda if payload.mmrLambda is not None else current.mmr_lambda,
            top_k=mmr_top_k,
        )
        mmr_time_ms = max(int((datetime.now() - mmr_started_at).total_seconds() * 1000), 0)

    should_run_rerank = payload.enableRerank and current.reranker_enabled and bool(query) and bool(ranked_results)
    if should_run_rerank:
        rerank_ran = True
        candidate_limit = min(
            max(current.reranker_candidate_min, payload.limit * 5),
            current.reranker_candidate_max,
        )
        rerank_candidates = (results if should_run_mmr else ranked_results)[:candidate_limit]
        rerank_result = await cross_encoder_rerank(
            session,
            user_id,
            query,
            rerank_candidates,
            top_n=min(payload.limit, current.reranker_top_n),
            settings=current,
        )
        results = rerank_result.results
        rerank_time_ms = rerank_result.rerank_time_ms

    reranker_threshold = (
        payload.rerankerThreshold
        if payload.rerankerThreshold is not None
        else current.reranker_min_score
    )
    results = [
        result
        for result in results
        if result.source != "reranked" or result.score >= reranker_threshold
    ][: payload.limit]

    elapsed_ms = max(int((datetime.now() - started_at).total_seconds() * 1000), 0)
    return SearchResponse(
        results=results,
        semanticCount=len(semantic_results),
        keywordCount=len(keyword_results),
        queryEmbeddingTimeMs=query_embedding_time_ms,
        searchTimeMs=elapsed_ms,
        preprocessTimeMs=preprocess_time_ms if preprocess_ran else None,
        mmrTimeMs=mmr_time_ms if mmr_ran else None,
        rerankTimeMs=rerank_time_ms if rerank_ran else None,
    )


async def search_with_context_service(
    session: AsyncSession,
    user_id: str,
    payload,
    settings: Settings | None = None,
) -> dict:
    response = await search_service(session, user_id, payload, settings=settings)
    return {
        **response.model_dump(),
        "context": build_search_context(response.results),
    }
