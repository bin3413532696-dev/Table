from __future__ import annotations

from datetime import datetime, time

from app.db.models import KnowledgeDocument, KnowledgeIndexJob
from app.schemas.knowledge_rag import (
    IndexJobResponse,
    KnowledgeChunkResponse,
    KnowledgeCorpusResponse,
    KnowledgeDocumentResponse,
    SearchResultResponse,
)

SEARCH_FILTER_FIELDS = {
    "tags",
    "documentIds",
    "limit",
    "publishDateRange",
    "sourceDept",
    "securityLevel",
    "businessCategory",
}


def to_document_response(document: KnowledgeDocument) -> KnowledgeDocumentResponse:
    return KnowledgeDocumentResponse(
        id=str(document.id),
        userId=str(document.user_id),
        corpusIds=[],
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


def to_corpus_response(corpus, document_ids: list[str]) -> KnowledgeCorpusResponse:
    return KnowledgeCorpusResponse(
        id=str(corpus.id),
        userId=str(corpus.user_id),
        name=corpus.name,
        description=corpus.description or "",
        defaultTags=list(corpus.default_tags_json or []),
        documentIds=document_ids,
        createdAt=int(corpus.created_at.timestamp() * 1000) if corpus.created_at else 0,
        updatedAt=int(corpus.updated_at.timestamp() * 1000) if corpus.updated_at else 0,
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


def _keyword_results_from_rows(
    rows: list[dict],
    query: str,
    threshold: float,
    source: str = "keyword",
) -> list[SearchResultResponse]:
    results: list[SearchResultResponse] = []
    for row in rows:
        score = _score_keyword_candidate(query, row["document_title"], row["content"])
        if score < threshold:
            continue
        results.append(_search_result_from_row(row, source=source, score=score))
    return results


def _semantic_results_from_rows(
    rows: list[dict],
    threshold: float,
    source: str = "semantic",
) -> list[SearchResultResponse]:
    results: list[SearchResultResponse] = []
    for row in rows:
        score = max(0.0, min(float(row["score"]), 1.0))
        if score < threshold:
            continue
        results.append(_search_result_from_row(row, source=source, score=score))
    return results


def _deduplicate_results(results: list[SearchResultResponse]) -> list[SearchResultResponse]:
    best_by_id: dict[str, SearchResultResponse] = {}
    for result in results:
        existing = best_by_id.get(result.id)
        if existing is None or result.score > existing.score:
            best_by_id[result.id] = result
    return sorted(best_by_id.values(), key=lambda item: item.score, reverse=True)


def _fuse_search_results(
    semantic_results: list[SearchResultResponse],
    keyword_results: list[SearchResultResponse],
    *,
    fusion_weight: float,
    rrf_k: int,
) -> list[SearchResultResponse]:
    semantic_ranks = {item.id: index + 1 for index, item in enumerate(semantic_results)}
    keyword_ranks = {item.id: index + 1 for index, item in enumerate(keyword_results)}
    base_results = {item.id: item for item in semantic_results}
    base_results.update({item.id: item for item in keyword_results})

    max_semantic_score = fusion_weight / (rrf_k + 1) if semantic_results else 0.0
    max_keyword_score = (1 - fusion_weight) / (rrf_k + 1) if keyword_results else 0.0
    max_joint_score = max_semantic_score + max_keyword_score

    fused_results: list[SearchResultResponse] = []
    for result_id in base_results:
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
