import json
from datetime import date
from uuid import UUID, uuid4

from app.db.models import (
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeEmbeddingCache,
    KnowledgeIndexJob,
)
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession


def normalize_tags(values: list[str] | None) -> list[str]:
    if not values:
        return []
    return [value for value in (item.strip() for item in values) if value]


def escape_like_pattern(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def parse_optional_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def parse_vector_from_db(vector_str: str) -> list[float]:
    text_value = vector_str.strip()
    if not text_value.startswith("[") or not text_value.endswith("]"):
        return []
    raw_values = [item.strip() for item in text_value[1:-1].split(",") if item.strip()]
    try:
        return [float(item) for item in raw_values]
    except ValueError:
        return []


async def list_documents_with_count(
    session: AsyncSession,
    user_id: str,
    filters: dict,
) -> tuple[list[KnowledgeDocument], int]:
    stmt = select(KnowledgeDocument).where(KnowledgeDocument.user_id == UUID(user_id))
    count_stmt = select(func.count()).select_from(KnowledgeDocument).where(KnowledgeDocument.user_id == UUID(user_id))

    if filters.get("status"):
        stmt = stmt.where(KnowledgeDocument.status == filters["status"])
        count_stmt = count_stmt.where(KnowledgeDocument.status == filters["status"])
    if filters.get("fileType"):
        stmt = stmt.where(KnowledgeDocument.file_type == filters["fileType"])
        count_stmt = count_stmt.where(KnowledgeDocument.file_type == filters["fileType"])
    tags = normalize_tags(filters.get("tags"))
    if tags:
        tag_conditions = [KnowledgeDocument.tags_json.contains([tag]) for tag in tags]
        stmt = stmt.where(or_(*tag_conditions))
        count_stmt = count_stmt.where(or_(*tag_conditions))
    if filters.get("publishDateStart"):
        start_date = parse_optional_date(filters["publishDateStart"])
        stmt = stmt.where(KnowledgeDocument.publish_date >= start_date)
        count_stmt = count_stmt.where(KnowledgeDocument.publish_date >= start_date)
    if filters.get("publishDateEnd"):
        end_date = parse_optional_date(filters["publishDateEnd"])
        stmt = stmt.where(KnowledgeDocument.publish_date <= end_date)
        count_stmt = count_stmt.where(KnowledgeDocument.publish_date <= end_date)
    if filters.get("sourceDept"):
        stmt = stmt.where(KnowledgeDocument.source_dept.in_(filters["sourceDept"]))
        count_stmt = count_stmt.where(KnowledgeDocument.source_dept.in_(filters["sourceDept"]))
    if filters.get("securityLevel"):
        stmt = stmt.where(KnowledgeDocument.security_level == filters["securityLevel"])
        count_stmt = count_stmt.where(KnowledgeDocument.security_level == filters["securityLevel"])
    if filters.get("businessCategory"):
        stmt = stmt.where(KnowledgeDocument.business_category.in_(filters["businessCategory"]))
        count_stmt = count_stmt.where(KnowledgeDocument.business_category.in_(filters["businessCategory"]))

    stmt = stmt.order_by(KnowledgeDocument.updated_at.desc()).limit(filters["limit"]).offset(filters["offset"])
    documents = list(await session.scalars(stmt))
    total = int(await session.scalar(count_stmt) or 0)
    return documents, total


async def find_document_by_id(session: AsyncSession, user_id: str, document_id: str) -> KnowledgeDocument | None:
    return await session.scalar(
        select(KnowledgeDocument).where(
            KnowledgeDocument.id == UUID(document_id),
            KnowledgeDocument.user_id == UUID(user_id),
        )
    )


async def find_document_by_id_for_update(
    session: AsyncSession,
    user_id: str,
    document_id: str,
) -> KnowledgeDocument | None:
    return await session.scalar(
        select(KnowledgeDocument)
        .where(
            KnowledgeDocument.id == UUID(document_id),
            KnowledgeDocument.user_id == UUID(user_id),
        )
        .with_for_update()
    )


async def create_document(
    session: AsyncSession,
    user_id: str,
    payload: dict,
) -> KnowledgeDocument:
    document = KnowledgeDocument(
        id=payload.get("id", uuid4()),
        user_id=UUID(user_id),
        title=payload["title"],
        summary=payload.get("summary", ""),
        content=payload.get("content", ""),
        source=payload.get("source"),
        file_type=payload.get("fileType"),
        file_size=payload.get("fileSize", 0),
        status=payload.get("status", "pending"),
        tags_json=normalize_tags(payload.get("tags")),
        content_hash=payload.get("contentHash"),
        version=payload.get("version", 1),
        publish_date=payload.get("publishDate"),
        source_dept=payload.get("sourceDept"),
        security_level=payload.get("securityLevel"),
        business_category=payload.get("businessCategory"),
        doc_language=payload.get("docLanguage"),
        parse_quality=payload.get("parseQuality"),
        has_ocr=payload.get("hasOcr", False),
        original_metadata=payload.get("originalMetadata"),
    )
    session.add(document)
    await session.commit()
    await session.refresh(document)
    return document


async def update_document(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    payload: dict,
) -> KnowledgeDocument | None:
    values: dict = {"updated_at": func.now()}
    if "title" in payload:
        values["title"] = payload["title"]
    if "summary" in payload:
        values["summary"] = payload["summary"]
    if "tags" in payload:
        values["tags_json"] = normalize_tags(payload["tags"])
    if "status" in payload:
        values["status"] = payload["status"]

    result = await session.execute(
        update(KnowledgeDocument)
        .where(KnowledgeDocument.id == UUID(document_id), KnowledgeDocument.user_id == UUID(user_id))
        .values(**values)
        .returning(KnowledgeDocument)
    )
    document = result.scalar_one_or_none()
    if document:
        await session.commit()
    else:
        await session.rollback()
    return document


async def delete_document(session: AsyncSession, user_id: str, document_id: str) -> bool:
    document = await find_document_by_id(session, user_id, document_id)
    if not document:
        return False

    await session.delete(document)
    await session.commit()
    return True


async def list_jobs_with_count(
    session: AsyncSession,
    user_id: str,
    filters: dict,
) -> tuple[list[KnowledgeIndexJob], int]:
    stmt = select(KnowledgeIndexJob).where(KnowledgeIndexJob.user_id == UUID(user_id))
    count_stmt = select(func.count()).select_from(KnowledgeIndexJob).where(KnowledgeIndexJob.user_id == UUID(user_id))

    if filters.get("status"):
        stmt = stmt.where(KnowledgeIndexJob.status == filters["status"])
        count_stmt = count_stmt.where(KnowledgeIndexJob.status == filters["status"])
    if filters.get("documentId"):
        stmt = stmt.where(KnowledgeIndexJob.document_id == UUID(filters["documentId"]))
        count_stmt = count_stmt.where(KnowledgeIndexJob.document_id == UUID(filters["documentId"]))

    stmt = stmt.order_by(KnowledgeIndexJob.created_at.desc()).limit(filters["limit"]).offset(filters["offset"])
    jobs = list(await session.scalars(stmt))
    total = int(await session.scalar(count_stmt) or 0)
    return jobs, total


async def find_job_by_id(session: AsyncSession, user_id: str, job_id: str) -> KnowledgeIndexJob | None:
    return await session.scalar(
        select(KnowledgeIndexJob).where(
            KnowledgeIndexJob.id == UUID(job_id),
            KnowledgeIndexJob.user_id == UUID(user_id),
        )
    )


async def find_active_job_for_document(
    session: AsyncSession,
    user_id: str,
    document_id: str,
) -> KnowledgeIndexJob | None:
    return await session.scalar(
        select(KnowledgeIndexJob)
        .where(
            KnowledgeIndexJob.user_id == UUID(user_id),
            KnowledgeIndexJob.document_id == UUID(document_id),
            KnowledgeIndexJob.status.in_(["pending", "running"]),
        )
        .order_by(KnowledgeIndexJob.created_at.desc())
        .limit(1)
    )


async def create_job(
    session: AsyncSession,
    user_id: str,
    *,
    document_id: str | None,
    job_type: str,
    status: str = "pending",
    progress: int = 0,
    error: dict | None = None,
) -> KnowledgeIndexJob:
    job = KnowledgeIndexJob(
        user_id=UUID(user_id),
        document_id=UUID(document_id) if document_id else None,
        job_type=job_type,
        status=status,
        progress=progress,
        error_json=error,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def update_job_status(
    session: AsyncSession,
    user_id: str,
    job_id: str,
    *,
    status: str,
    progress: int | None = None,
    error: dict | None = None,
) -> KnowledgeIndexJob | None:
    values: dict = {"status": status}
    if progress is not None:
        values["progress"] = progress
    if error is not None:
        values["error_json"] = error
    if status == "running":
        values["started_at"] = func.now()
    elif status in {"completed", "failed"}:
        values["completed_at"] = func.now()

    result = await session.execute(
        update(KnowledgeIndexJob)
        .where(KnowledgeIndexJob.id == UUID(job_id), KnowledgeIndexJob.user_id == UUID(user_id))
        .values(**values)
        .returning(KnowledgeIndexJob)
    )
    job = result.scalar_one_or_none()
    if job:
        await session.commit()
    else:
        await session.rollback()
    return job


async def list_chunks_with_count(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    rows = (
        await session.execute(
            text(
                """
                SELECT id, document_id, user_id, content, content_hash, chunk_index, start_pos, end_pos,
                       heading_chain, heading_level, embedding_model, embedding_dimensions, embedding_version,
                       chunk_type, parent_id, created_at, updated_at,
                       (embedding IS NOT NULL) AS has_embedding
                FROM knowledge_chunks
                WHERE document_id = CAST(:document_id AS uuid) AND user_id = CAST(:user_id AS uuid)
                ORDER BY chunk_index ASC
                LIMIT :limit
                OFFSET :offset
                """
            ),
            {
                "document_id": document_id,
                "user_id": user_id,
                "limit": limit,
                "offset": offset,
            },
        )
    ).mappings().all()

    count = await session.execute(
        text(
            """
            SELECT COUNT(*) AS count
            FROM knowledge_chunks
            WHERE document_id = CAST(:document_id AS uuid) AND user_id = CAST(:user_id AS uuid)
            """
        ),
        {"document_id": document_id, "user_id": user_id},
    )
    total = int(count.mappings().one()["count"])
    return [dict(row) for row in rows], total


async def get_chunk_by_id(
    session: AsyncSession,
    user_id: str,
    chunk_id: str,
) -> dict | None:
    row = (
        await session.execute(
            text(
                """
                SELECT
                  c.id,
                  c.document_id,
                  c.user_id,
                  c.content,
                  c.content_hash,
                  c.chunk_index,
                  c.start_pos,
                  c.end_pos,
                  c.heading_chain,
                  c.heading_level,
                  c.embedding_model,
                  c.embedding_dimensions,
                  c.embedding_version,
                  c.chunk_type,
                  c.parent_id,
                  p.content AS parent_content,
                  c.created_at,
                  c.updated_at,
                  (c.embedding IS NOT NULL) AS has_embedding,
                  d.title AS document_title
                FROM knowledge_chunks c
                JOIN knowledge_documents d ON c.document_id = d.id
                LEFT JOIN knowledge_chunks p ON c.parent_id = p.id
                WHERE c.id = CAST(:chunk_id AS uuid)
                  AND c.user_id = CAST(:user_id AS uuid)
                  AND d.user_id = CAST(:user_id AS uuid)
                LIMIT 1
                """
            ),
            {
                "chunk_id": chunk_id,
                "user_id": user_id,
            },
        )
    ).mappings().first()
    return dict(row) if row else None


async def delete_chunks_by_document(session: AsyncSession, user_id: str, document_id: str) -> int:
    result = await session.execute(
        text(
            """
            DELETE FROM knowledge_chunks
            WHERE document_id = CAST(:document_id AS uuid) AND user_id = CAST(:user_id AS uuid)
            """
        ),
        {"document_id": document_id, "user_id": user_id},
    )
    await session.commit()
    return int(result.rowcount or 0)


async def create_chunks(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    chunks: list[dict],
) -> int:
    if not chunks:
        return 0

    rows = [
        {
            "id": str(chunk["id"]),
            "document_id": document_id,
            "user_id": user_id,
            "content": chunk["content"],
            "content_hash": chunk["contentHash"],
            "chunk_index": chunk["chunkIndex"],
            "start_pos": chunk["startPos"],
            "end_pos": chunk["endPos"],
            "heading_chain": chunk.get("headingChain"),
            "heading_level": chunk.get("headingLevel"),
            "embedding_dimensions": chunk.get("embeddingDimensions"),
            "embedding_version": chunk.get("embeddingVersion"),
            "chunk_type": chunk.get("chunkType", "small"),
            "parent_id": chunk.get("parentId"),
        }
        for chunk in chunks
    ]

    insert_sql = text(
        """
        INSERT INTO knowledge_chunks (
          id, document_id, user_id, content, content_hash,
          chunk_index, start_pos, end_pos,
          heading_chain, heading_level,
          embedding_dimensions, embedding_version,
          chunk_type, parent_id, created_at, updated_at
        ) VALUES (
          CAST(:id AS uuid),
          CAST(:document_id AS uuid),
          CAST(:user_id AS uuid),
          :content,
          :content_hash,
          :chunk_index,
          :start_pos,
          :end_pos,
          :heading_chain,
          :heading_level,
          :embedding_dimensions,
          :embedding_version,
          :chunk_type,
          CAST(:parent_id AS uuid),
          NOW(),
          NOW()
        )
        """
    )
    parent_rows = [row for row in rows if row["chunk_type"] == "parent"]
    child_rows = [row for row in rows if row["chunk_type"] != "parent"]
    if parent_rows:
        await session.execute(insert_sql, parent_rows)
    if child_rows:
        await session.execute(insert_sql, child_rows)
    await session.commit()
    return len(rows)


async def find_embedding_cache_batch(
    session: AsyncSession,
    user_id: str,
    content_hashes: list[str],
    embedding_model: str,
) -> dict[str, str]:
    if not content_hashes:
        return {}

    rows = (
        await session.execute(
            text(
                """
                SELECT content_hash, embedding::text AS embedding
                FROM knowledge_embedding_cache
                WHERE user_id = CAST(:user_id AS uuid)
                  AND content_hash = ANY(CAST(:content_hashes AS text[]))
                  AND embedding_model = :embedding_model
                  AND (expires_at IS NULL OR expires_at > NOW())
                """
            ),
            {
                "user_id": user_id,
                "content_hashes": content_hashes,
                "embedding_model": embedding_model,
            },
        )
    ).mappings().all()
    return {row["content_hash"]: row["embedding"] for row in rows}


async def store_embedding_cache(
    session: AsyncSession,
    user_id: str,
    *,
    content_hash: str,
    embedding_vector: str,
    embedding_model: str,
    expires_at,
) -> None:
    await session.execute(
        text(
            """
            INSERT INTO knowledge_embedding_cache (
              id, user_id, content_hash, embedding, embedding_model, created_at, expires_at
            )
            VALUES (
              gen_random_uuid(),
              CAST(:user_id AS uuid),
              :content_hash,
              CAST(:embedding_vector AS vector),
              :embedding_model,
              NOW(),
              :expires_at
            )
            ON CONFLICT (user_id, content_hash, embedding_model) DO UPDATE
            SET embedding = CAST(:embedding_vector AS vector),
                expires_at = :expires_at
            """
        ),
        {
            "user_id": user_id,
            "content_hash": content_hash,
            "embedding_vector": embedding_vector,
            "embedding_model": embedding_model,
            "expires_at": expires_at,
        },
    )
    await session.commit()


async def update_chunk_embeddings_batch(
    session: AsyncSession,
    user_id: str,
    updates: list[dict],
) -> int:
    if not updates:
        return 0

    for update_payload in updates:
        await session.execute(
            text(
                """
                UPDATE knowledge_chunks
                SET embedding = CAST(:embedding_vector AS vector),
                    embedding_model = :embedding_model,
                    embedding_version = :embedding_version,
                    embedding_dimensions = :embedding_dimensions,
                    updated_at = NOW()
                WHERE id = CAST(:chunk_id AS uuid)
                  AND user_id = CAST(:user_id AS uuid)
                """
            ),
            {
                "chunk_id": update_payload["chunkId"],
                "user_id": user_id,
                "embedding_vector": update_payload["embeddingVector"],
                "embedding_model": update_payload["embeddingModel"],
                "embedding_version": update_payload["embeddingVersion"],
                "embedding_dimensions": update_payload["embeddingDimensions"],
            },
        )
    await session.commit()
    return len(updates)


async def get_chunks_without_embedding(
    session: AsyncSession,
    user_id: str,
    document_id: str,
) -> list[dict]:
    rows = (
        await session.execute(
            text(
                """
                SELECT id, document_id, user_id, content, content_hash, chunk_index, start_pos, end_pos,
                       chunk_type, parent_id, created_at, updated_at
                FROM knowledge_chunks
                WHERE document_id = CAST(:document_id AS uuid)
                  AND user_id = CAST(:user_id AS uuid)
                  AND embedding IS NULL
                  AND COALESCE(chunk_type, 'small') = 'small'
                ORDER BY chunk_index ASC
                """
            ),
            {
                "document_id": document_id,
                "user_id": user_id,
            },
        )
    ).mappings().all()
    return [dict(row) for row in rows]


async def get_chunk_embeddings_batch(
    session: AsyncSession,
    user_id: str,
    chunk_ids: list[str],
    *,
    embedding_version: int,
) -> dict[str, list[float]]:
    if not chunk_ids:
        return {}

    rows = (
        await session.execute(
            text(
                """
                SELECT id::text AS id, embedding::text AS embedding
                FROM knowledge_chunks
                WHERE id = ANY(CAST(:chunk_ids AS uuid[]))
                  AND user_id = CAST(:user_id AS uuid)
                  AND embedding IS NOT NULL
                  AND embedding_version = :embedding_version
                """
            ),
            {
                "chunk_ids": chunk_ids,
                "user_id": user_id,
                "embedding_version": embedding_version,
            },
        )
    ).mappings().all()

    embeddings: dict[str, list[float]] = {}
    for row in rows:
        vector = parse_vector_from_db(row["embedding"])
        if vector:
            embeddings[row["id"]] = vector
    return embeddings


async def get_rag_stats(session: AsyncSession, user_id: str) -> dict[str, int]:
    document_count = int(
        await session.scalar(select(func.count()).select_from(KnowledgeDocument).where(KnowledgeDocument.user_id == UUID(user_id)))
        or 0
    )
    indexed_document_count = int(
        await session.scalar(
            select(func.count()).select_from(KnowledgeDocument).where(
                KnowledgeDocument.user_id == UUID(user_id),
                KnowledgeDocument.status == "indexed",
            )
        )
        or 0
    )
    chunk_count = int(
        await session.scalar(select(func.count()).select_from(KnowledgeChunk).where(KnowledgeChunk.user_id == UUID(user_id)))
        or 0
    )
    chunk_with_embedding_count = int(
        (
            await session.execute(
                text(
                    """
                    SELECT COUNT(*) AS count
                    FROM knowledge_chunks
                    WHERE user_id = CAST(:user_id AS uuid) AND embedding IS NOT NULL
                    """
                ),
                {"user_id": user_id},
            )
        ).mappings().one()["count"]
    )
    cache_count = int(
        await session.scalar(
            select(func.count()).select_from(KnowledgeEmbeddingCache).where(
                KnowledgeEmbeddingCache.user_id == UUID(user_id),
                or_(
                    KnowledgeEmbeddingCache.expires_at.is_(None),
                    KnowledgeEmbeddingCache.expires_at > func.now(),
                ),
            )
        )
        or 0
    )
    return {
        "documentCount": document_count,
        "indexedDocumentCount": indexed_document_count,
        "chunkCount": chunk_count,
        "chunkWithEmbeddingCount": chunk_with_embedding_count,
        "cacheCount": cache_count,
    }


async def keyword_search_chunks(
    session: AsyncSession,
    user_id: str,
    filters: dict,
) -> list[dict]:
    parent_chunk = aliased(KnowledgeChunk)
    stmt = (
        select(
            KnowledgeChunk.id.label("id"),
            KnowledgeChunk.document_id.label("document_id"),
            KnowledgeChunk.content.label("content"),
            KnowledgeChunk.parent_id.label("parent_id"),
            parent_chunk.id.label("parent_chunk_id"),
            parent_chunk.content.label("parent_content"),
            KnowledgeChunk.chunk_index.label("chunk_index"),
            KnowledgeChunk.updated_at.label("updated_at"),
            KnowledgeDocument.title.label("document_title"),
            KnowledgeDocument.source.label("source"),
            KnowledgeDocument.publish_date.label("publish_date"),
            KnowledgeDocument.source_dept.label("source_dept"),
            KnowledgeDocument.security_level.label("security_level"),
            KnowledgeDocument.business_category.label("business_category"),
            KnowledgeDocument.has_ocr.label("has_ocr"),
            KnowledgeDocument.parse_quality.label("parse_quality"),
        )
        .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
        .outerjoin(parent_chunk, KnowledgeChunk.parent_id == parent_chunk.id)
        .where(
            KnowledgeChunk.user_id == UUID(user_id),
            KnowledgeDocument.user_id == UUID(user_id),
            KnowledgeDocument.status == "indexed",
            KnowledgeChunk.chunk_type == "small",
        )
    )

    query = (filters.get("query") or "").strip()
    if query:
        pattern = f"%{escape_like_pattern(query)}%"
        stmt = stmt.where(
            or_(
                KnowledgeChunk.content.ilike(pattern, escape="\\"),
                KnowledgeDocument.title.ilike(pattern, escape="\\"),
            )
        )

    tags = normalize_tags(filters.get("tags"))
    if tags:
        tag_conditions = [KnowledgeDocument.tags_json.contains([tag]) for tag in tags]
        stmt = stmt.where(or_(*tag_conditions))

    document_ids = filters.get("documentIds") or []
    if document_ids:
        stmt = stmt.where(KnowledgeDocument.id.in_([UUID(document_id) for document_id in document_ids]))

    publish_date_range = filters.get("publishDateRange") or {}
    if publish_date_range.get("start"):
        stmt = stmt.where(KnowledgeDocument.publish_date >= parse_optional_date(publish_date_range["start"]))
    if publish_date_range.get("end"):
        stmt = stmt.where(KnowledgeDocument.publish_date <= parse_optional_date(publish_date_range["end"]))

    if filters.get("sourceDept"):
        stmt = stmt.where(KnowledgeDocument.source_dept.in_(filters["sourceDept"]))
    if filters.get("securityLevel"):
        stmt = stmt.where(KnowledgeDocument.security_level == filters["securityLevel"])
    if filters.get("businessCategory"):
        stmt = stmt.where(KnowledgeDocument.business_category.in_(filters["businessCategory"]))

    # Pull a wider candidate set and score in Python.
    candidate_limit = max(int(filters.get("limit", 10)) * 10, 50)
    stmt = stmt.order_by(KnowledgeChunk.updated_at.desc()).limit(candidate_limit)
    rows = (await session.execute(stmt)).mappings().all()
    return [dict(row) for row in rows]


async def semantic_search_chunks(
    session: AsyncSession,
    user_id: str,
    *,
    embedding_vector: str,
    embedding_version: int,
    filters: dict,
) -> list[dict]:
    sql_parts = [
        """
        SELECT
          c.id,
          c.document_id,
          c.content,
          c.parent_id,
          p.id AS parent_chunk_id,
          p.content AS parent_content,
          c.chunk_index,
          c.updated_at,
          d.title AS document_title,
          d.source,
          d.publish_date,
          d.source_dept,
          d.security_level,
          d.business_category,
          d.has_ocr,
          d.parse_quality,
          1 - (c.embedding <=> CAST(:embedding_vector AS vector)) AS score
        FROM knowledge_chunks c
        JOIN knowledge_documents d ON c.document_id = d.id
        LEFT JOIN knowledge_chunks p ON c.parent_id = p.id
        WHERE c.user_id = CAST(:user_id AS uuid)
          AND d.user_id = CAST(:user_id AS uuid)
          AND d.status = 'indexed'
          AND c.chunk_type = 'small'
          AND c.embedding IS NOT NULL
          AND c.embedding_version = :embedding_version
        """
    ]
    params: dict = {
        "embedding_vector": embedding_vector,
        "user_id": user_id,
        "embedding_version": embedding_version,
        "limit": max(int(filters.get("limit", 10)) * 10, 50),
    }

    tags = normalize_tags(filters.get("tags"))
    if tags:
        tag_clauses: list[str] = []
        for index, tag in enumerate(tags):
            key = f"tag_filter_{index}"
            params[key] = json.dumps([tag], ensure_ascii=True)
            tag_clauses.append(f"d.tags_json @> CAST(:{key} AS jsonb)")
        sql_parts.append(" AND (" + " OR ".join(tag_clauses) + ")")

    document_ids = filters.get("documentIds") or []
    if document_ids:
        params["document_ids"] = document_ids
        sql_parts.append(" AND d.id = ANY(CAST(:document_ids AS uuid[]))")

    publish_date_range = filters.get("publishDateRange") or {}
    if publish_date_range.get("start"):
        params["publish_date_start"] = parse_optional_date(publish_date_range["start"])
        sql_parts.append(" AND d.publish_date >= :publish_date_start")
    if publish_date_range.get("end"):
        params["publish_date_end"] = parse_optional_date(publish_date_range["end"])
        sql_parts.append(" AND d.publish_date <= :publish_date_end")
    if filters.get("sourceDept"):
        params["source_dept"] = filters["sourceDept"]
        sql_parts.append(" AND d.source_dept = ANY(CAST(:source_dept AS text[]))")
    if filters.get("securityLevel"):
        params["security_level"] = filters["securityLevel"]
        sql_parts.append(" AND d.security_level = :security_level")
    if filters.get("businessCategory"):
        params["business_category"] = filters["businessCategory"]
        sql_parts.append(" AND d.business_category = ANY(CAST(:business_category AS text[]))")

    sql_parts.append(" ORDER BY c.embedding <=> CAST(:embedding_vector AS vector) ASC LIMIT :limit")
    rows = (await session.execute(text("".join(sql_parts)), params)).mappings().all()
    return [dict(row) for row in rows]
