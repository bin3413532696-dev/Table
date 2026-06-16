import asyncio
import logging
import re
from datetime import datetime, time
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from app.core.config import REPO_ROOT, Settings, get_settings
from app.db.models import KnowledgeDocument, KnowledgeIndexJob
from app.db.session import SessionLocal
from app.integrations.ocr_service import OCRServiceClient, OCRServiceSettings
from app.repositories.knowledge_rag import (
    create_chunks,
    create_document,
    create_job,
    delete_chunks_by_document,
    delete_document,
    find_active_job_for_document,
    find_document_by_id,
    find_document_by_id_for_update,
    find_embedding_cache_batch,
    find_job_by_id,
    get_chunk_embeddings_batch,
    get_chunks_without_embedding,
    get_rag_stats,
    keyword_search_chunks,
    list_chunks_with_count,
    list_documents_with_count,
    list_jobs_with_count,
    semantic_search_chunks,
    store_embedding_cache,
    find_image_description_cache,
    store_image_description_cache,
    update_document,
    update_chunk_embeddings_batch,
    update_job_status,
)
from app.services.knowledge_rag_embeddings import (
    EmbeddingChunkInput,
    EmbeddingRuntimeConfig,
    embed_chunk_batch,
    embed_query,
    embedding_provider_available,
    format_vector_for_db,
    resolve_embedding_runtime_config,
)
from app.services.knowledge_rag_indexing import chunk_document_content
from app.services.knowledge_rag_mmr import mmr_rerank
from app.services.knowledge_rag_query_preprocessor import preprocess_query
from app.services.knowledge_rag_reranker import cross_encoder_rerank
from app.schemas.knowledge_rag import (
    ChunkListQuery,
    DocumentListQuery,
    IndexJobResponse,
    JobListQuery,
    KnowledgeChunkResponse,
    KnowledgeDocumentResponse,
    OCRHealthResponse,
    RagStatsResponse,
    SearchResponse,
    SearchResultResponse,
    TriggerIndexRequest,
    UpdateDocumentRequest,
)
from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("table-python-backend")

ACTIVE_INDEX_JOB_STATUSES = {"pending", "running"}
SEARCH_FILTER_FIELDS = {
    "tags",
    "documentIds",
    "limit",
    "publishDateRange",
    "sourceDept",
    "securityLevel",
    "businessCategory",
}


class IndexJobActiveError(RuntimeError):
    def __init__(self, job: KnowledgeIndexJob):
        self.job = job
        self.detail = {
            "code": "index_job_active",
            "documentId": str(job.document_id) if job.document_id else None,
            "jobId": str(job.id),
            "jobStatus": job.status or "pending",
            "message": "An indexing job is already active for this document.",
        }
        super().__init__(self.detail["message"])


class DocumentQualityError(Exception):
    """PDF 文本层质量未达预检阈值，应拒绝入库。"""

    def __init__(self, *, reason: str, metrics: dict, threshold: float):
        self.reason = reason
        self.metrics = metrics
        self.threshold = threshold
        self.detail = {            "error": "DOCUMENT_QUALITY_INSUFFICIENT",
            "message": "该文档质量不达标，请检查后重新上传",
            "reason": reason,
            "metrics": metrics,
            "threshold": threshold,
        }
        super().__init__(reason)


def to_document_response(document: KnowledgeDocument) -> KnowledgeDocumentResponse:
    return KnowledgeDocumentResponse(
        id=str(document.id),
        userId=str(document.user_id),
        title=document.title,
        summary=document.summary or "",
        content=document.content or "",
        source=document.source,
        fileType=document.file_type,
        fileSize=document.file_size or 0,
        status=document.status or "pending",
        tags=[item for item in (document.tags_json or []) if isinstance(item, str)],
        contentHash=document.content_hash,
        version=document.version or 1,
        publishDate=_publish_date_ms(document.publish_date),
        sourceDept=document.source_dept,
        securityLevel=document.security_level,
        businessCategory=document.business_category,
        docLanguage=document.doc_language,
        parseQuality=document.parse_quality,
        hasOcr=document.has_ocr,
        originalMetadata=document.original_metadata,
        createdAt=int(document.created_at.timestamp() * 1000) if document.created_at else 0,
        updatedAt=int(document.updated_at.timestamp() * 1000) if document.updated_at else 0,
    )


def to_job_response(job: KnowledgeIndexJob) -> IndexJobResponse:
    return IndexJobResponse(
        id=str(job.id),
        userId=str(job.user_id),
        documentId=str(job.document_id) if job.document_id else None,
        jobType=job.job_type,
        status=job.status or "pending",
        progress=job.progress or 0,
        error=job.error_json,
        startedAt=int(job.started_at.timestamp() * 1000) if job.started_at else None,
        completedAt=int(job.completed_at.timestamp() * 1000) if job.completed_at else None,
        createdAt=int(job.created_at.timestamp() * 1000) if job.created_at else 0,
    )


def to_chunk_response(row: dict) -> KnowledgeChunkResponse:
    return KnowledgeChunkResponse(
        id=str(row["id"]),
        documentId=str(row["document_id"]),
        userId=str(row["user_id"]),
        content=row["content"],
        contentHash=row["content_hash"],
        chunkIndex=row["chunk_index"] or 0,
        startPos=row["start_pos"] or 0,
        endPos=row["end_pos"] or 0,
        headingChain=row.get("heading_chain"),
        headingLevel=row.get("heading_level"),
        embeddingDimensions=row.get("embedding_dimensions"),
        embeddingVersion=row.get("embedding_version"),
        chunkType=row.get("chunk_type"),
        parentId=str(row["parent_id"]) if row.get("parent_id") else None,
        hasEmbedding=bool(row.get("has_embedding")),
        embeddingModel=row.get("embedding_model"),
        createdAt=int(row["created_at"].timestamp() * 1000),
        updatedAt=int(row["updated_at"].timestamp() * 1000),
    )


def _publish_date_ms(value) -> int | None:
    if not value:
        return None
    return int(datetime.combine(value, time.min).timestamp() * 1000)


def _tokenize_query(query: str) -> list[str]:
    return [term.strip().lower() for term in query.split() if term.strip()]


def _contains_keyword_phrase(value: str, query: str) -> bool:
    normalized_query = query.strip().lower()
    return len(normalized_query) >= 2 and normalized_query in value.lower()


def _score_keyword_candidate(query: str, title: str, content: str) -> float:
    if not query:
        return 0.0

    title_lower = title.lower()
    content_lower = content.lower()
    score = 0.0
    title_phrase_match = _contains_keyword_phrase(title, query)
    content_phrase_match = _contains_keyword_phrase(content, query)

    if title_phrase_match:
        score += 0.6
    if content_phrase_match:
        score += 0.4

    for token in _tokenize_query(query):
        if len(token) < 2:
            continue
        if not title_phrase_match and token in title_lower:
            score += 0.08
        if not content_phrase_match and token in content_lower:
            score += 0.05

    return min(score, 1.0)


def _search_result_from_row(row: dict, *, source: str, score: float) -> SearchResultResponse:
    return SearchResultResponse(
        id=str(row["id"]),
        documentId=str(row["document_id"]),
        documentTitle=row["document_title"],
        content=row["content"],
        parentChunkId=str(row["parent_chunk_id"]) if row.get("parent_chunk_id") else None,
        parentContent=row.get("parent_content"),
        chunkIndex=row["chunk_index"] or 0,
        score=score,
        source=source,
        sourceInfo=row.get("source"),
        publishDate=_publish_date_ms(row.get("publish_date")),
        sourceDept=row.get("source_dept"),
        securityLevel=row.get("security_level"),
        businessCategory=row.get("business_category"),
    )


def _keyword_results_from_rows(rows: list[dict], query: str, threshold: float, source: str = "keyword") -> list[SearchResultResponse]:
    scored_rows: list[tuple[float, dict]] = []
    for row in rows:
        score = _score_keyword_candidate(query, row["document_title"], row["content"])
        if score < threshold:
            continue
        scored_rows.append((score, row))

    scored_rows.sort(key=lambda item: (item[0], item[1]["updated_at"]), reverse=True)
    return [_search_result_from_row(row, source=source, score=score) for score, row in scored_rows]


def _semantic_results_from_rows(rows: list[dict], threshold: float, source: str = "semantic") -> list[SearchResultResponse]:
    results = [
        _search_result_from_row(row, source=source, score=float(row.get("score") or 0.0))
        for row in rows
        if float(row.get("score") or 0.0) >= threshold
    ]
    return sorted(results, key=lambda item: item.score, reverse=True)


def _deduplicate_results(results: list[SearchResultResponse]) -> list[SearchResultResponse]:
    best_by_id: dict[str, SearchResultResponse] = {}
    for result in results:
        current = best_by_id.get(result.id)
        if current is None or result.score > current.score:
            best_by_id[result.id] = result
    return sorted(best_by_id.values(), key=lambda item: item.score, reverse=True)


def _fuse_search_results(
    semantic_results: list[SearchResultResponse],
    keyword_results: list[SearchResultResponse],
    *,
    fusion_weight: float,
    rrf_k: int,
) -> list[SearchResultResponse]:
    if semantic_results and not keyword_results:
        return sorted(semantic_results, key=lambda item: item.score, reverse=True)
    if keyword_results and not semantic_results:
        return sorted(keyword_results, key=lambda item: item.score, reverse=True)
    if not semantic_results and not keyword_results:
        return []

    semantic_sorted = sorted(semantic_results, key=lambda item: item.score, reverse=True)
    keyword_sorted = sorted(keyword_results, key=lambda item: item.score, reverse=True)

    semantic_ranks = {result.id: index + 1 for index, result in enumerate(semantic_sorted)}
    keyword_ranks = {result.id: index + 1 for index, result in enumerate(keyword_sorted)}
    base_results = {result.id: result for result in keyword_sorted}
    base_results.update({result.id: result for result in semantic_sorted})

    ordered_ids = list(dict.fromkeys([result.id for result in semantic_sorted + keyword_sorted]))
    fused_results: list[SearchResultResponse] = []
    max_joint_score = fusion_weight / (rrf_k + 1) + (1 - fusion_weight) / (rrf_k + 1)
    max_semantic_score = fusion_weight / (rrf_k + 1)
    max_keyword_score = (1 - fusion_weight) / (rrf_k + 1)

    for result_id in ordered_ids:
        semantic_rank = semantic_ranks.get(result_id)
        keyword_rank = keyword_ranks.get(result_id)

        semantic_score = fusion_weight / (rrf_k + semantic_rank) if semantic_rank is not None else 0.0
        keyword_score = (1 - fusion_weight) / (rrf_k + keyword_rank) if keyword_rank is not None else 0.0
        rrf_score = semantic_score + keyword_score

        if semantic_rank is not None and keyword_rank is not None:
            normalized_score = min(1.0, rrf_score / max_joint_score)
            source = "hybrid"
        elif semantic_rank is not None:
            normalized_score = min(1.0, rrf_score / max_semantic_score) if max_semantic_score else 0.0
            source = base_results[result_id].source
        else:
            normalized_score = min(1.0, rrf_score / max_keyword_score) if max_keyword_score else 0.0
            source = base_results[result_id].source

        fused_results.append(
            base_results[result_id].model_copy(
                update={
                    "score": normalized_score,
                    "source": source,
                }
            )
        )

    return sorted(fused_results, key=lambda item: item.score, reverse=True)


def _extract_search_filters(payload) -> dict:
    raw_filters = payload.model_dump(exclude_none=True)
    return {key: raw_filters[key] for key in SEARCH_FILTER_FIELDS if key in raw_filters}


def _is_soft_embedding_failure(exc: Exception) -> bool:
    message = str(exc)
    return message.startswith("Embedding request failed:") or message.startswith("Embedding dimension mismatch:")


async def _apply_chunk_embeddings(
    session: AsyncSession,
    user_id: str,
    chunks: list[dict],
    *,
    settings: Settings,
    runtime_config: EmbeddingRuntimeConfig | None = None,
    require_provider: bool = False,
) -> int:
    if not chunks:
        return 0

    resolved_runtime_config = runtime_config or await resolve_embedding_runtime_config(session, user_id, settings)
    if resolved_runtime_config is None:
        if require_provider:
            raise RuntimeError("Embedding provider is not configured")
        return 0

    chunk_inputs = [
        EmbeddingChunkInput(
            chunk_id=str(chunk["id"]),
            content_hash=chunk["contentHash"],
            content=chunk["content"],
        )
        for chunk in chunks
    ]
    content_hashes = list(dict.fromkeys(chunk.content_hash for chunk in chunk_inputs))
    cached_embeddings = await find_embedding_cache_batch(session, user_id, content_hashes, resolved_runtime_config.model)

    unique_missing_inputs: list[EmbeddingChunkInput] = []
    seen_hashes = set(cached_embeddings)
    for chunk in chunk_inputs:
        if chunk.content_hash in seen_hashes:
            continue
        seen_hashes.add(chunk.content_hash)
        unique_missing_inputs.append(chunk)

    if unique_missing_inputs:
        embedded_chunks = await embed_chunk_batch(
            unique_missing_inputs,
            settings,
            runtime_config=resolved_runtime_config,
        )
        for embedded in embedded_chunks:
            embedding_vector = format_vector_for_db(embedded["embedding"])
            cached_embeddings[embedded["contentHash"]] = embedding_vector
            await store_embedding_cache(
                session,
                user_id,
                content_hash=embedded["contentHash"],
                embedding_vector=embedding_vector,
                embedding_model=embedded["embeddingModel"],
                expires_at=None,
            )

    updates = [
        {
            "chunkId": chunk.chunk_id,
            "embeddingVector": cached_embeddings[chunk.content_hash],
            "embeddingModel": resolved_runtime_config.model,
            "embeddingVersion": settings.embedding_version,
            "embeddingDimensions": settings.embedding_dimensions,
        }
        for chunk in chunk_inputs
        if chunk.content_hash in cached_embeddings
    ]
    if not updates:
        return 0

    return await update_chunk_embeddings_batch(session, user_id, updates)


def build_search_context(results: list[SearchResultResponse], max_chars: int = 4000) -> str:
    parts: list[str] = []
    current_length = 0
    seen_context_ids: set[str] = set()
    for result in results:
        context_id = result.parentChunkId or result.id
        if context_id in seen_context_ids:
            continue
        context_content = (result.parentContent or result.content).strip()
        block = f"[{result.documentTitle}] {context_content}".strip()
        if parts and current_length + len(block) > max_chars:
            break
        parts.append(block)
        seen_context_ids.add(context_id)
        current_length += len(block) + 2
    return "\n\n".join(parts)


async def get_documents(session: AsyncSession, user_id: str, query: DocumentListQuery) -> tuple[list[KnowledgeDocumentResponse], int]:
    documents, total = await list_documents_with_count(session, user_id, query.model_dump(exclude_none=True))
    return [to_document_response(document) for document in documents], total


async def get_document(session: AsyncSession, user_id: str, document_id: str) -> KnowledgeDocumentResponse | None:
    document = await find_document_by_id(session, user_id, document_id)
    if not document:
        return None
    return to_document_response(document)


async def update_document_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    payload: UpdateDocumentRequest,
) -> KnowledgeDocumentResponse | None:
    document = await update_document(session, user_id, document_id, payload.model_dump(exclude_unset=True))
    if not document:
        return None
    return to_document_response(document)


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


async def backfill_embeddings_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    settings: Settings | None = None,
) -> dict[str, int]:
    current = settings or get_settings()
    document = await find_document_by_id(session, user_id, document_id)
    if not document:
        raise ValueError("Document not found")

    rows = await get_chunks_without_embedding(session, user_id, document_id)
    if not rows:
        return {"count": 0}

    count = await _apply_chunk_embeddings(
        session,
        user_id,
        [
            {
                "id": row["id"],
                "content": row["content"],
                "contentHash": row["content_hash"],
            }
            for row in rows
        ],
        settings=current,
        require_provider=True,
    )
    return {"count": count}


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
            enable_rewrite=payload.enableRewrite if payload.enableRewrite is not None else current.query_rewrite_enabled,
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

    reranker_threshold = payload.rerankerThreshold if payload.rerankerThreshold is not None else current.reranker_min_score
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


def _default_upload_dir(settings: Settings) -> Path:
    return Path(settings.rag_upload_dir) if settings.rag_upload_dir else REPO_ROOT / "server" / "data" / "uploads"


def _document_upload_dir(settings: Settings, user_id: str) -> Path:
    return _default_upload_dir(settings) / user_id


def _find_uploaded_document_path(settings: Settings, user_id: str, document_id: str) -> Path | None:
    upload_dir = _document_upload_dir(settings, user_id)
    for path in sorted(upload_dir.glob(f"{document_id}.*")):
        if path.is_file():
            return path
    return None


def _extension_to_file_type(filename: str) -> str | None:
    return {
        ".pdf": "pdf",
        ".md": "md",
        ".markdown": "markdown",
        ".txt": "txt",
    }.get(Path(filename).suffix.lower())


def _assemble_ocr_text(payload: dict) -> str:
    metadata = payload.get("metadata") or {}
    text_blocks = payload.get("text_blocks") or payload.get("textBlocks") or []
    tables = payload.get("tables") or []
    page_count = metadata.get("page_count") or metadata.get("pageCount") or 1
    pages: list[str] = []

    for page_num in range(1, int(page_count) + 1):
        lines: list[str] = []
        if page_num > 1:
            lines.append(f"--- Page {page_num} ---")

        for block in text_blocks:
            if block.get("page") != page_num:
                continue
            content = block.get("content", "")
            if not content:
                continue
            if block.get("type") == "title":
                lines.append(f"## {content}")
            elif block.get("type") == "list_item":
                lines.append(f"- {content}")
            else:
                lines.append(content)

        for table in tables:
            if table.get("page") != page_num:
                continue
            rows = table.get("cells") or []
            if not rows:
                continue
            header = rows[0]
            lines.append("| " + " | ".join(header) + " |")
            lines.append("| " + " | ".join(["---"] * len(header)) + " |")
            for row in rows[1:]:
                lines.append("| " + " | ".join(row) + " |")

        if lines:
            pages.append("\n".join(lines))

    return "\n".join(pages).strip()


def _decode_text_content(raw_bytes: bytes) -> tuple[str, str]:
    if not raw_bytes:
        return "", "utf-8"

    if raw_bytes.startswith(b"\xef\xbb\xbf"):
        return raw_bytes.decode("utf-8-sig"), "utf-8-sig"
    if raw_bytes.startswith(b"\xff\xfe"):
        return raw_bytes.decode("utf-16"), "utf-16"
    if raw_bytes.startswith(b"\xfe\xff"):
        return raw_bytes.decode("utf-16"), "utf-16"

    candidates: list[str] = ["utf-8", "gb18030", "gbk"]
    null_ratio = raw_bytes.count(0) / max(len(raw_bytes), 1)
    if null_ratio > 0.1:
        candidates = ["utf-16", "utf-16-le", "utf-16-be", *candidates]

    first_success: tuple[str, str] | None = None
    for encoding in candidates:
        try:
            decoded = raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue

        if first_success is None:
            first_success = (decoded, encoding)
        if decoded.strip():
            return decoded, encoding

    if first_success is not None:
        return first_success

    return raw_bytes.decode("utf-8", errors="ignore"), "utf-8-ignore"


def _extract_pdf_text_locally(raw_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""

    try:
        reader = PdfReader(BytesIO(raw_bytes))
    except Exception:
        return ""

    pages: list[str] = []
    for page_num, page in enumerate(reader.pages, start=1):
        try:
            page_text = (page.extract_text() or "").strip()
        except Exception:
            page_text = ""

        if not page_text:
            continue

        if page_num > 1:
            pages.append(f"--- Page {page_num} ---\n{page_text}")
        else:
            pages.append(page_text)

    return "\n\n".join(pages).strip()


_VALID_CHAR_CATEGORIES = frozenset({"L", "N", "P", "S", "Z"})
_ZERO_WIDTH_CHARS = frozenset({"​", "‌", "‍", "﻿", "­"})


def _count_valid_chars(text: str) -> int:
    """统计有效字符：字母/数字/标点/符号 + 普通空白，排除控制符与零宽字符。"""
    import unicodedata

    count = 0
    for ch in text:
        if ch in ("\n", "\r", "\t", " "):
            count += 1
            continue
        if ch in _ZERO_WIDTH_CHARS:
            continue
        if unicodedata.category(ch)[0] in _VALID_CHAR_CATEGORIES:
            count += 1
    return count


def _preflight_pdf_quality(
    raw_bytes: bytes,
    settings: Settings,
) -> tuple[bool, str, dict]:
    """
    返回 (passed, reason, metrics)。
    passed=True 表示通过预检或属于扫描件（跳过，继续走 OCR pipeline）。
    passed=False 表示质量不达标，应拒绝。
    """
    if not settings.rag_quality_preflight_enabled:
        return True, "preflight disabled", {}

    try:
        from pypdf import PdfReader
    except ImportError:
        return True, "pypdf unavailable", {}

    try:
        reader = PdfReader(BytesIO(raw_bytes))
    except Exception:
        return True, "pdf unreadable by pypdf", {}

    max_pages = settings.rag_quality_preflight_max_pages
    sample_pages = reader.pages[:max_pages]

    total_chars = 0
    valid_chars = 0
    for page in sample_pages:
        try:
            page_text = page.extract_text() or ""
        except Exception:
            page_text = ""
        total_chars += len(page_text)
        valid_chars += _count_valid_chars(page_text)

    metrics: dict = {
        "sampledPages": len(sample_pages),
        "totalPages": len(reader.pages),
        "sampledChars": total_chars,
        "validChars": valid_chars,
        "threshold": settings.rag_quality_min_valid_ratio,
    }

    if total_chars < settings.rag_quality_scan_detection_chars:
        metrics["verdict"] = "scan_like"
        return True, "scan-like PDF, will fall through to OCR", metrics

    valid_ratio = valid_chars / total_chars
    metrics["validRatio"] = round(valid_ratio, 4)

    if valid_ratio < settings.rag_quality_min_valid_ratio:
        metrics["verdict"] = "rejected"
        return False, (
            f"PDF text layer quality insufficient "
            f"(valid ratio {valid_ratio:.2%} < threshold "
            f"{settings.rag_quality_min_valid_ratio:.2%})"
        ), metrics

    metrics["verdict"] = "passed"
    return True, "passed", metrics


async def _extract_upload_content(
    *,
    file_path: Path,
    file_type: str,
    raw_bytes: bytes,
    settings: Settings,
) -> tuple[str, dict | None, str | None, bool]:
    if file_type in {"txt", "md", "markdown"}:
        content, encoding = _decode_text_content(raw_bytes)
        return content, {"textEncoding": encoding}, "direct", False

    if file_type == "pdf":
        from app.services.knowledge_rag_pdf import extract_pdf_with_images

        # pypdf 探针：极快，用于判断是否扫描件（决定走 MarkItDown 还是 OCR）
        probe_text = _extract_pdf_text_locally(raw_bytes)
        scan_like = bool(probe_text) and len(probe_text) < settings.rag_quality_scan_detection_chars
        is_scan = not probe_text or scan_like

        # OCR fallback：扫描件或文本层不可用
        async def _ocr_fallback() -> tuple[str, dict | None, str | None, bool]:
            client = OCRServiceClient(
                OCRServiceSettings(
                    service_url=settings.ocr_service_url,
                    enabled=settings.ocr_enabled,
                    timeout_ms=settings.ocr_timeout_ms,
                )
            )
            ocr_error: str | None = None
            if await client.is_available():
                try:
                    payload = await client.process_pdf(str(file_path))
                    ocr_text = _assemble_ocr_text(payload)
                    if ocr_text.strip():
                        return ocr_text, payload, "ocr", True
                    ocr_error = "OCR returned no extractable text"
                except Exception as exc:
                    ocr_error = f"OCR processing failed: {exc}"
            else:
                ocr_error = "OCR service unavailable"
            if probe_text:
                metadata = {"parseMethod": "pdf_text"}
                if ocr_error:
                    metadata["ocrError"] = ocr_error
                return probe_text, metadata, "pdf_text", False
            metadata = {"parseMethod": "pdf_text"}
            if ocr_error:
                metadata["ocrError"] = ocr_error
            return "", metadata, "pdf_text_unavailable", False

        if is_scan:
            return await _ocr_fallback()

        # 文本层 PDF：MarkItDown 主路径 + PyMuPDF 图片提取
        if settings.rag_pdf_parser == "markitdown":
            try:
                result = await extract_pdf_with_images(
                    raw_bytes,
                    file_path=file_path,
                    settings=settings,
                    ocr_fallback=_ocr_fallback,
                )
                return result.markdown, result.metadata, "pdf_markitdown", False
            except Exception as exc:
                logger.warning("MarkItDown path failed, falling back to OCR: %s", exc)
                return await _ocr_fallback()

        # 兼容旧 parser=pypdf（保留旧行为，不提图）
        if probe_text and len(probe_text) >= settings.rag_pdf_text_fast_path_min_chars:
            return probe_text, {"parseMethod": "pdf_text_fast_path"}, "pdf_text", False

        return await _ocr_fallback()

    return "", None, None, False


async def _load_document_content_for_indexing(
    session: AsyncSession,
    user_id: str,
    document: KnowledgeDocument,
    *,
    settings: Settings,
) -> tuple[str, str | None]:
    if (document.content or "").strip():
        return document.content or "", document.file_type

    file_path = _find_uploaded_document_path(settings, user_id, str(document.id))
    if file_path is None:
        return "", document.file_type

    raw_bytes = file_path.read_bytes()
    file_type = document.file_type or _extension_to_file_type(file_path.name)
    if file_type is None:
        return "", document.file_type

    content, _, _, _ = await _extract_upload_content(
        file_path=file_path,
        file_type=file_type,
        raw_bytes=raw_bytes,
        settings=settings,
    )
    return content, file_type


async def _create_index_job_with_guard(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    *,
    job_type: str,
) -> tuple[KnowledgeDocument, KnowledgeIndexJob]:
    document = await find_document_by_id_for_update(session, user_id, document_id)
    if not document:
        raise ValueError("Document not found")

    active_job = await find_active_job_for_document(session, user_id, document_id)
    if active_job and (active_job.status or "") in ACTIVE_INDEX_JOB_STATUSES:
        await session.rollback()
        raise IndexJobActiveError(active_job)

    job = await create_job(
        session,
        user_id,
        document_id=document_id,
        job_type=job_type,
        status="pending",
        progress=0,
        error=None,
    )
    return document, job


_PLACEHOLDER_RE = None


def _image_placeholder_regex() -> re.Pattern:
    global _PLACEHOLDER_RE
    if _PLACEHOLDER_RE is None:
        _PLACEHOLDER_RE = re.compile(r"\[IMAGE:page=(\d+);idx=(\d+)\]")
    return _PLACEHOLDER_RE


def _find_image_file(images_dir: Path, page_num: int, image_index: int) -> Path | None:
    if not images_dir.exists():
        return None
    for ext in ("png", "jpg", "jpeg"):
        candidate = images_dir / f"page_{page_num}_idx_{image_index}.{ext}"
        if candidate.exists():
            return candidate
    return None


async def _describe_single_image_vlm(
    *,
    image_path: Path,
    runtime_config,
    semaphore: asyncio.Semaphore,
) -> str:
    """只跑 VLM 调用（带并发信号量）。无 DB 操作，可并发。失败抛异常。"""
    image_bytes = image_path.read_bytes()
    mime_type = "image/jpeg" if image_path.suffix.lower() in {".jpg", ".jpeg"} else "image/png"
    from app.services.knowledge_rag_vision import describe_image

    async with semaphore:
        return await describe_image(
            image_bytes, mime_type=mime_type, runtime_config=runtime_config
        )


async def _describe_images_and_replace_placeholders(
    *,
    session: AsyncSession,
    user_id: str,
    document_id: str,
    content: str,
    settings: Settings,
) -> str:
    """扫描 content 里的图片占位符，逐张调 VLM 描述，原地替换。

    三阶段（避免 AsyncSession 并发使用）：
    1. 串行：缓存查询 → 命中的描述直接收集
    2. gather + semaphore：未命中并发跑 VLM（HTTP，无 DB 操作）
    3. 串行：写缓存 + 构建替换 map
    """
    if not settings.rag_vision_llm_enabled:
        return content
    if "[IMAGE:" not in content:
        return content

    from app.services.knowledge_rag_vision import resolve_vision_llm_runtime_config

    runtime_config = await resolve_vision_llm_runtime_config(session, user_id, settings)
    if runtime_config is None:
        logger.info(
            "Vision LLM unavailable; leaving %d image placeholders as-is",
            len(_image_placeholder_regex().findall(content)),
        )
        return content

    file_path = _find_uploaded_document_path(settings, user_id, document_id)
    if file_path is None:
        return content
    images_dir = file_path.parent / f"{file_path.stem}_images"

    placeholders = list(_image_placeholder_regex().finditer(content))
    if not placeholders:
        return content

    max_images = settings.rag_vision_llm_max_images_per_doc
    semaphore = asyncio.Semaphore(max(1, settings.rag_vision_llm_max_concurrency))

    tasks_to_process = placeholders[:max_images]
    skipped = placeholders[max_images:]

    # Phase 1: 串行缓存查询
    pending: list[tuple[re.Match, Path, str]] = []  # (match, image_path, content_hash)
    descriptions: dict[str, str] = {}  # original_placeholder -> description

    for match in tasks_to_process:
        page_num = int(match.group(1))
        idx = int(match.group(2))
        image_path = _find_image_file(images_dir, page_num, idx)
        if image_path is None:
            descriptions[match.group(0)] = f"[图片文件缺失：page={page_num},idx={idx}]"
            continue
        image_bytes = image_path.read_bytes()
        content_hash = sha256(image_bytes).hexdigest()
        cached = await find_image_description_cache(
            session, user_id, content_hash=content_hash, model=runtime_config.model
        )
        if cached:
            descriptions[match.group(0)] = cached
            continue
        pending.append((match, image_path, content_hash))

    # Phase 2: 并发跑 VLM（仅 HTTP，不碰 session）
    async def _safe_vlm(image_path: Path, match: re.Match) -> tuple[str, str | None, str | None]:
        """返回 (original_placeholder, description_or_None, error_or_None)"""
        try:
            desc = await _describe_single_image_vlm(
                image_path=image_path, runtime_config=runtime_config, semaphore=semaphore,
            )
            return match.group(0), desc, None
        except Exception as exc:
            logger.warning("VLM describe_image failed for %s: %s", image_path.name, exc)
            return match.group(0), None, str(exc)

    vlm_results = await asyncio.gather(*(_safe_vlm(ip, m) for m, ip, _ in pending))

    # Phase 3: 串行写缓存 + 收集描述
    pending_hashes = {(m.group(0)): ch for m, _, ch in pending}
    for original, desc, err in vlm_results:
        if desc is None:
            descriptions[original] = f"[图片描述失败：{err}]"
            continue
        descriptions[original] = desc
        content_hash = pending_hashes.get(original)
        if content_hash:
            try:
                await store_image_description_cache(
                    session, user_id,
                    content_hash=content_hash,
                    description=desc,
                    model=runtime_config.model,
                    source_kind="vlm",
                )
            except Exception as exc:
                logger.warning("Failed to cache image description: %s", exc)

    for m in skipped:
        descriptions[m.group(0)] = "[图片描述跳过：超出单文档上限]"

    def _format_desc(original: str, desc: str) -> str:
        # 从 original 解析 page_num 用于标注
        m = _image_placeholder_regex().match(original)
        page_num = m.group(1) if m else "?"
        return f"\n\n[图片描述 (page {page_num})]\n{desc}\n"

    def _replace(match):
        desc = descriptions.get(match.group(0))
        if desc is None:
            return match.group(0)
        if desc.startswith("[图片"):
            return f"\n\n{desc}\n"
        return _format_desc(match.group(0), desc)

    return _image_placeholder_regex().sub(_replace, content)


async def _run_indexing_pipeline_task(
    *,
    user_id: str,
    document_id: str,
    job_id: str,
    file_type: str | None,
    settings: Settings,
) -> None:
    """异步 pipeline 任务：独立 session 跑完整索引流程（OCR → chunking → embedding → 入库）。
    不依赖请求生命周期；显式传 user_id，不依赖 ContextVar。"""
    async with SessionLocal() as session:
        try:
            document = await find_document_by_id(session, user_id, document_id)
            job = await find_job_by_id(session, user_id, job_id)
            if not document or not job:
                return

            content, resolved_file_type = await _load_document_content_for_indexing(
                session, user_id, document, settings=settings,
            )

            # 图片描述子阶段：把 [IMAGE:page=N;idx=M] 占位符替换为 VLM 描述
            if "[IMAGE:" in content:
                try:
                    content = await _describe_images_and_replace_placeholders(
                        session=session, user_id=user_id, document_id=document_id,
                        content=content, settings=settings,
                    )
                    # 回写到 document.content，避免下次重跑
                    await update_document(session, user_id, document_id, {"content": content})
                    await session.commit()
                except Exception as exc:
                    logger.warning("Image description phase failed (continuing with placeholders): %s", exc)

            await execute_indexing_pipeline(
                session, user_id,
                document=document, job=job,
                content=content,
                file_type=file_type or resolved_file_type,
                settings=settings,
            )
        except Exception as exc:
            # execute_indexing_pipeline 内部已经把大部分失败转成 failed 状态返回；
            # 这里只兜底意外异常（session 问题、加载失败等）
            try:
                await update_document(session, user_id, document_id, {"status": "failed"})
                await update_job_status(
                    session, user_id, job_id,
                    status="failed",
                    error={"message": f"pipeline task crashed: {exc}"},
                )
                await session.commit()
            except Exception:
                pass


async def upload_document_service(
    session: AsyncSession,
    user_id: str,
    *,
    file: UploadFile,
    title: str | None,
    tags: list[str],
    settings: Settings | None = None,
) -> dict:
    current = settings or get_settings()
    file_type = _extension_to_file_type(file.filename or "")
    if not file_type:
        raise ValueError(f"Unsupported file type: {Path(file.filename or '').suffix.lower()}")

    raw_bytes = await file.read()
    max_size_bytes = current.index_max_file_size_mb * 1024 * 1024
    if len(raw_bytes) > max_size_bytes:
        raise ValueError(f"File is too large. Max supported size is {current.index_max_file_size_mb}MB")

    document_id = uuid4()
    upload_dir = _document_upload_dir(current, user_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "").suffix.lower()
    file_path = upload_dir / f"{document_id}{suffix}"
    file_path.write_bytes(raw_bytes)

    if file_type == "pdf":
        passed, reason, metrics = _preflight_pdf_quality(raw_bytes, current)
        if not passed:
            file_path.unlink(missing_ok=True)
            raise DocumentQualityError(
                reason=reason,
                metrics=metrics,
                threshold=current.rag_quality_min_valid_ratio,
            )

    document = await create_document(
        session,
        user_id,
        {
            "id": document_id,
            "title": (title or file.filename or "Untitled").strip(),
            "summary": "",
            "content": "",
            "source": file.filename,
            "fileType": file_type,
            "fileSize": len(raw_bytes),
            "status": "pending",
            "tags": tags,
            "contentHash": sha256(raw_bytes).hexdigest(),
            "version": 1,
        },
    )
    try:
        job = await create_job(
            session,
            user_id,
            document_id=str(document.id),
            job_type="full_index",
            status="pending",
            progress=0,
            error=None,
        )
    except Exception:
        # job 创建失败 → 删除已 commit 的 document，避免孤儿
        await delete_document(session, user_id, str(document.id))
        file_path.unlink(missing_ok=True)
        raise

    # fire-and-forget 异步 pipeline；请求立即返回 pending job
    asyncio.create_task(_run_indexing_pipeline_task(
        user_id=user_id,
        document_id=str(document.id),
        job_id=str(job.id),
        file_type=file_type,
        settings=current,
    ))

    return {
        "document": to_document_response(document),
        "job": to_job_response(job),
    }


async def delete_document_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    settings: Settings | None = None,
) -> bool:
    current = settings or get_settings()
    existing = await find_document_by_id(session, user_id, document_id)
    if not existing:
        return False

    deleted = await delete_document(session, user_id, document_id)
    if not deleted:
        return False

    upload_dir = _document_upload_dir(current, user_id)
    for path in upload_dir.glob(f"{document_id}.*"):
        path.unlink(missing_ok=True)
    return True


async def trigger_index_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    payload: TriggerIndexRequest,
    settings: Settings | None = None,
) -> dict:
    current = settings or get_settings()
    document = await find_document_by_id(session, user_id, document_id)
    if not document:
        raise ValueError("Document not found")

    if not payload.force and document.status == "indexed":
        return {"message": "Document is already indexed; reindex is not required."}

    document, job = await _create_index_job_with_guard(
        session,
        user_id,
        document_id,
        job_type="reindex",
    )
    content, file_type = await _load_document_content_for_indexing(
        session,
        user_id,
        document,
        settings=current,
    )
    document, job = await execute_indexing_pipeline(
        session,
        user_id,
        document=document,
        job=job,
        content=content,
        file_type=file_type,
        settings=current,
    )
    return {"job": to_job_response(job)}


async def execute_indexing_pipeline(
    session: AsyncSession,
    user_id: str,
    *,
    document: KnowledgeDocument,
    job: KnowledgeIndexJob,
    content: str,
    file_type: str | None,
    settings: Settings | None = None,
) -> tuple[KnowledgeDocument, KnowledgeIndexJob]:
    current = settings or get_settings()
    embedding_warning: dict | None = None
    running_job = await update_job_status(
        session,
        user_id,
        str(job.id),
        status="running",
        progress=10,
        error=None,
    )
    current_document = await update_document(
        session,
        user_id,
        str(document.id),
        {"status": "processing"},
    )
    if not running_job or not current_document:
        raise RuntimeError("Failed to initialize indexing state")

    try:
        if not content.strip():
            raise ValueError("Document content could not be extracted for indexing")

        await delete_chunks_by_document(session, user_id, str(document.id))
        chunks = chunk_document_content(content, file_type)
        if not chunks:
            raise ValueError("Document content could not be chunked")

        await create_chunks(session, user_id, str(document.id), chunks)
        running_job = await update_job_status(
            session,
            user_id,
            str(job.id),
            status="running",
            progress=60,
            error=None,
        )
        if not running_job:
            raise RuntimeError("Failed to update indexing progress after chunking")

        try:
            small_chunks = [chunk for chunk in chunks if chunk.get("chunkType") == "small"]
            embedding_count = await _apply_chunk_embeddings(
                session,
                user_id,
                small_chunks,
                settings=current,
            )
        except Exception as exc:
            if not _is_soft_embedding_failure(exc):
                raise
            embedding_count = 0
            embedding_warning = {"message": str(exc)}

        has_embedding_provider = await embedding_provider_available(session, user_id, current)
        progress = 90 if embedding_count or not has_embedding_provider else 80
        running_job = await update_job_status(
            session,
            user_id,
            str(job.id),
            status="running",
            progress=progress,
            error=embedding_warning,
        )
        if not running_job:
            raise RuntimeError("Failed to update indexing progress after embedding")

        current_document = await update_document(
            session,
            user_id,
            str(document.id),
            {
                "status": "indexed",
                "summary": content[:200] + ("..." if len(content) > 200 else ""),
            },
        )
        running_job = await update_job_status(
            session,
            user_id,
            str(job.id),
            status="completed",
            progress=100,
            error=embedding_warning,
        )
        if not current_document or not running_job:
            raise RuntimeError("Failed to finalize indexing state")
        return current_document, running_job
    except Exception as exc:
        failed_document = await update_document(
            session,
            user_id,
            str(document.id),
            {"status": "failed"},
        )
        failed_job = await update_job_status(
            session,
            user_id,
            str(job.id),
            status="failed",
            error={"message": str(exc)},
        )
        if not failed_document or not failed_job:
            raise
        return failed_document, failed_job
