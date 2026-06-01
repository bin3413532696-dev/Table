from datetime import datetime, time
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from app.core.config import REPO_ROOT, Settings, get_settings
from app.db.models import KnowledgeDocument, KnowledgeIndexJob
from app.integrations.ocr_service import OCRServiceClient, OCRServiceSettings
from app.repositories.knowledge_rag import (
    create_chunks,
    create_document,
    create_job,
    delete_chunks_by_document,
    delete_document,
    find_document_by_id,
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


def _score_keyword_candidate(query: str, title: str, content: str) -> float:
    if not query:
        return 0.0

    query_lower = query.lower()
    title_lower = title.lower()
    content_lower = content.lower()
    score = 0.0

    if query_lower in title_lower:
        score += 0.6
    if query_lower in content_lower:
        score += 0.4

    for token in _tokenize_query(query):
        if token in title_lower:
            score += 0.08
        if token in content_lower:
            score += 0.05

    return min(score, 1.0)


def _search_result_from_row(row: dict, *, source: str, score: float) -> SearchResultResponse:
    return SearchResultResponse(
        id=str(row["id"]),
        documentId=str(row["document_id"]),
        documentTitle=row["document_title"],
        content=row["content"],
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
    for result in results:
        block = f"[{result.documentTitle}] {result.content}".strip()
        if parts and current_length + len(block) > max_chars:
            break
        parts.append(block)
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
    base_filters = payload.model_dump(exclude_none=True)
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


async def _extract_upload_content(
    *,
    file_path: Path,
    file_type: str,
    raw_bytes: bytes,
    settings: Settings,
) -> tuple[str, dict | None, str | None, bool]:
    if file_type in {"txt", "md", "markdown"}:
        return raw_bytes.decode("utf-8", errors="ignore"), None, "direct", False

    if file_type == "pdf":
        client = OCRServiceClient(
            OCRServiceSettings(
                service_url=settings.ocr_service_url,
                enabled=settings.ocr_enabled,
                timeout_ms=settings.ocr_timeout_ms,
            )
        )
        if await client.is_available():
            payload = await client.process_pdf(str(file_path))
            return _assemble_ocr_text(payload), payload, "ocr", True
        return "", {"ocrError": "OCR service unavailable"}, "ocr_unavailable", False

    return "", None, None, False


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
    upload_dir = _default_upload_dir(current) / user_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "").suffix.lower()
    file_path = upload_dir / f"{document_id}{suffix}"
    file_path.write_bytes(raw_bytes)
    document: KnowledgeDocument | None = None

    try:
        content, original_metadata, parse_quality, has_ocr = await _extract_upload_content(
            file_path=file_path,
            file_type=file_type,
            raw_bytes=raw_bytes,
            settings=current,
        )
        summary = content[:200] + ("..." if len(content) > 200 else "")
        document = await create_document(
            session,
            user_id,
            {
                "id": document_id,
                "title": (title or file.filename or "Untitled").strip(),
                "summary": summary,
                "content": content,
                "source": file.filename,
                "fileType": file_type,
                "fileSize": len(raw_bytes),
                "status": "pending",
                "tags": tags,
                "contentHash": sha256(raw_bytes).hexdigest(),
                "version": 1,
                "parseQuality": parse_quality,
                "hasOcr": has_ocr,
                "originalMetadata": original_metadata,
            },
        )
        job = await create_job(
            session,
            user_id,
            document_id=str(document.id),
            job_type="full_index",
            status="pending",
            progress=0,
            error=None,
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
        return {
            "document": to_document_response(document),
            "job": to_job_response(job),
            "metadata": original_metadata,
            "parseQuality": parse_quality,
        }
    except Exception:
        if document is not None:
            await delete_document(session, user_id, str(document.id))
        raise
    finally:
        file_path.unlink(missing_ok=True)


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

    upload_dir = _default_upload_dir(current) / user_id
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

    job = await create_job(
        session,
        user_id,
        document_id=document_id,
        job_type="reindex",
        status="pending",
        progress=0,
    )
    document, job = await execute_indexing_pipeline(
        session,
        user_id,
        document=document,
        job=job,
        content=document.content or "",
        file_type=document.file_type,
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

        embedding_count = await _apply_chunk_embeddings(
            session,
            user_id,
            chunks,
            settings=current,
        )
        has_embedding_provider = await embedding_provider_available(session, user_id, current)
        progress = 90 if embedding_count or not has_embedding_provider else 80
        running_job = await update_job_status(
            session,
            user_id,
            str(job.id),
            status="running",
            progress=progress,
            error=None,
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
            error=None,
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
