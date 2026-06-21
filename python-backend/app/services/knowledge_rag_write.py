from __future__ import annotations

import asyncio
from hashlib import sha256
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models import KnowledgeDocument, KnowledgeIndexJob
from app.schemas.knowledge_rag import TriggerIndexRequest
from app.services.knowledge_rag_collaborators import (
    DeleteDocumentCollaborators,
    ExecuteIndexingPipelineCollaborators,
    TriggerIndexCollaborators,
    UploadDocumentCollaborators,
)


async def upload_document_service(
    session: AsyncSession,
    user_id: str,
    *,
    file: UploadFile,
    title: str | None,
    tags: list[str],
    settings: Settings | None = None,
    collaborators: UploadDocumentCollaborators,
) -> dict:
    current = settings or get_settings()
    file_type = collaborators.extension_to_file_type(file.filename or "")
    if not file_type:
        raise ValueError(f"Unsupported file type: {Path(file.filename or '').suffix.lower()}")

    raw_bytes = await file.read()
    max_size_bytes = current.index_max_file_size_mb * 1024 * 1024
    if len(raw_bytes) > max_size_bytes:
        raise ValueError(f"File is too large. Max supported size is {current.index_max_file_size_mb}MB")

    document_id = collaborators.uuid4()
    upload_dir = collaborators.document_upload_dir(current, user_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "").suffix.lower()
    file_path = upload_dir / f"{document_id}{suffix}"
    file_path.write_bytes(raw_bytes)

    if file_type == "pdf":
        passed, reason, metrics = collaborators.preflight_pdf_quality(raw_bytes, current)
        if not passed:
            file_path.unlink(missing_ok=True)
            raise collaborators.document_quality_error(
                reason=reason,
                metrics=metrics,
                threshold=current.rag_quality_min_valid_ratio,
            )

    document = await collaborators.create_document(
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
        job = await collaborators.create_job(
            session,
            user_id,
            document_id=str(document.id),
            job_type="full_index",
            status="pending",
            progress=0,
            error=None,
        )
    except Exception:
        await collaborators.delete_document(session, user_id, str(document.id))
        file_path.unlink(missing_ok=True)
        raise

    asyncio.create_task(
        collaborators.run_indexing_pipeline_task(
            user_id=user_id,
            document_id=str(document.id),
            job_id=str(job.id),
            file_type=file_type,
            settings=current,
        )
    )

    return {
        "document": collaborators.to_document_response(document),
        "job": collaborators.to_job_response(job),
    }


async def delete_document_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    collaborators: DeleteDocumentCollaborators,
    settings: Settings | None = None,
) -> bool:
    current = settings or get_settings()
    existing = await collaborators.find_document_by_id(session, user_id, document_id)
    if not existing:
        return False

    deleted = await collaborators.delete_document(session, user_id, document_id)
    if not deleted:
        return False

    upload_dir = collaborators.document_upload_dir(current, user_id)
    for path in upload_dir.glob(f"{document_id}.*"):
        path.unlink(missing_ok=True)
    return True


async def trigger_index_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    payload: TriggerIndexRequest,
    collaborators: TriggerIndexCollaborators,
    settings: Settings | None = None,
) -> dict:
    document = await collaborators.find_document_by_id(session, user_id, document_id)
    if not document:
        raise ValueError("Document not found")

    if not payload.force and document.status == "indexed":
        return {"message": "Document is already indexed; reindex is not required."}

    document, job = await collaborators.create_index_job_with_guard(
        session,
        user_id,
        document_id,
        job_type="reindex",
    )
    asyncio.create_task(
        collaborators.run_indexing_pipeline_task(
            user_id=user_id,
            document_id=str(document.id),
            job_id=str(job.id),
            file_type=document.file_type,
            settings=settings or get_settings(),
        )
    )
    return {"job": collaborators.to_job_response(job)}


async def execute_indexing_pipeline(
    session: AsyncSession,
    user_id: str,
    *,
    document: KnowledgeDocument,
    job: KnowledgeIndexJob,
    content: str,
    file_type: str | None,
    collaborators: ExecuteIndexingPipelineCollaborators,
    settings: Settings | None = None,
) -> tuple[KnowledgeDocument, KnowledgeIndexJob]:
    current = settings or get_settings()
    embedding_warning: dict | None = None
    running_job = await collaborators.update_job_status(
        session,
        user_id,
        str(job.id),
        status="running",
        progress=10,
        error=None,
    )
    current_document = await collaborators.update_document(
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

        await collaborators.delete_chunks_by_document(session, user_id, str(document.id))
        chunks = collaborators.chunk_document_content(content, file_type)
        if not chunks:
            raise ValueError("Document content could not be chunked")

        await collaborators.create_chunks(session, user_id, str(document.id), chunks)
        running_job = await collaborators.update_job_status(
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
            embedding_count = await collaborators.apply_chunk_embeddings(
                session,
                user_id,
                small_chunks,
                settings=current,
                skip_cache_lookup=job.job_type == "reindex",
            )
        except Exception as exc:
            if not collaborators.is_soft_embedding_failure(exc):
                raise
            embedding_count = 0
            embedding_warning = {"message": str(exc)}

        has_embedding_provider = await collaborators.embedding_provider_available(session, user_id, current)
        progress = 90 if embedding_count or not has_embedding_provider else 80
        running_job = await collaborators.update_job_status(
            session,
            user_id,
            str(job.id),
            status="running",
            progress=progress,
            error=embedding_warning,
        )
        if not running_job:
            raise RuntimeError("Failed to update indexing progress after embedding")

        current_document = await collaborators.update_document(
            session,
            user_id,
            str(document.id),
            {
                "status": "indexed",
                "summary": content[:200] + ("..." if len(content) > 200 else ""),
            },
        )
        running_job = await collaborators.update_job_status(
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
        failed_document = await collaborators.update_document(
            session,
            user_id,
            str(document.id),
            {"status": "failed"},
        )
        failed_job = await collaborators.update_job_status(
            session,
            user_id,
            str(job.id),
            status="failed",
            error={"message": str(exc)},
        )
        if not failed_document or not failed_job:
            raise
        return failed_document, failed_job
