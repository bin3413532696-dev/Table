from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import UploadFile

import app.services.knowledge_rag_embedding_support as knowledge_rag_embedding_support
import app.services.knowledge_rag_errors as knowledge_rag_errors
import app.services.knowledge_rag_ingest as knowledge_rag_ingest
import app.services.knowledge_rag_write as knowledge_rag_write
from app.core.config import Settings
from app.schemas.knowledge_rag import TriggerIndexRequest
from app.services.knowledge_rag_collaborators import (
    CreateIndexJobCollaborators,
    ExecuteIndexingPipelineCollaborators,
    TriggerIndexCollaborators,
    UploadDocumentCollaborators,
)


class _RollbackSession:
    def __init__(self) -> None:
        self.rollback_called = False

    async def rollback(self) -> None:
        self.rollback_called = True


def _run_task_coro(coro) -> SimpleNamespace:
    original_create_task = asyncio.tasks.create_task

    async def _runner():
        await coro

    task = original_create_task(_runner())
    return SimpleNamespace(cancel=task.cancel)


def _build_document(
    document_id: str,
    *,
    title: str = "Test Doc",
    status: str = "pending",
    content: str = "",
    file_type: str = "txt",
    source: str = "notes.txt",
) -> SimpleNamespace:
    timestamp = datetime(2026, 6, 1, tzinfo=UTC)
    return SimpleNamespace(
        id=uuid.UUID(document_id),
        user_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        title=title,
        summary=content[:200],
        content=content,
        source=source,
        file_type=file_type,
        file_size=len(content.encode("utf-8")),
        status=status,
        tags_json=[],
        content_hash="hash",
        version=1,
        publish_date=None,
        source_dept=None,
        security_level=None,
        business_category=None,
        doc_language="zh",
        parse_quality="direct",
        has_ocr=False,
        original_metadata=None,
        created_at=timestamp,
        updated_at=timestamp,
    )


def _build_job(document_id: str) -> SimpleNamespace:
    created_at = datetime(2026, 6, 1, tzinfo=UTC)
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        document_id=uuid.UUID(document_id),
        job_type="full_index",
        status="failed",
        progress=0,
        error_json={"message": "OCR unavailable"},
        started_at=None,
        completed_at=None,
        created_at=created_at,
    )


def _upload_collaborators(
    *,
    create_document,
    create_job,
    uuid4,
    run_indexing_pipeline_task=None,
) -> UploadDocumentCollaborators:
    async def _noop_delete_document(*args, **kwargs):
        del args, kwargs

    async def _noop_run_indexing_pipeline_task(**kwargs):
        del kwargs

    return UploadDocumentCollaborators(
        document_quality_error=knowledge_rag_errors.DocumentQualityError,
        document_upload_dir=knowledge_rag_ingest.document_upload_dir,
        extension_to_file_type=knowledge_rag_ingest.extension_to_file_type,
        preflight_pdf_quality=knowledge_rag_ingest.preflight_pdf_quality,
        run_indexing_pipeline_task=run_indexing_pipeline_task or _noop_run_indexing_pipeline_task,
        create_document=create_document,
        create_job=create_job,
        delete_document=_noop_delete_document,
        to_document_response=lambda document: SimpleNamespace(id=str(document.id)),
        to_job_response=lambda job: job,
        uuid4=uuid4,
    )


def _close_task_coro(coro) -> SimpleNamespace:
    coro.close()
    return SimpleNamespace(cancel=lambda: None)


@pytest.mark.asyncio
async def test_trigger_index_service_rejects_active_job() -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    document = SimpleNamespace(id=uuid.UUID(document_id), status="failed", content="", file_type="txt")
    active_job = SimpleNamespace(
        id=uuid.uuid4(),
        document_id=uuid.UUID(document_id),
        status="running",
    )
    session = _RollbackSession()

    async def fake_find_document_by_id(current_session, requested_user_id, requested_document_id):
        del current_session
        assert requested_user_id == user_id
        assert requested_document_id == document_id
        return document

    async def fake_find_document_by_id_for_update(current_session, requested_user_id, requested_document_id):
        del current_session
        assert requested_user_id == user_id
        assert requested_document_id == document_id
        return document

    async def fake_find_active_job_for_document(current_session, requested_user_id, requested_document_id):
        del current_session
        assert requested_user_id == user_id
        assert requested_document_id == document_id
        return active_job

    async def fake_create_job(*args, **kwargs):
        raise AssertionError("create_job should not run when an active job exists")

    async def fake_create_index_job_with_guard(current_session, requested_user_id, requested_document_id, *, job_type):
        return await knowledge_rag_ingest.create_index_job_with_guard(
            current_session,
            requested_user_id,
            requested_document_id,
            job_type=job_type,
            collaborators=CreateIndexJobCollaborators(
                index_job_active_error=knowledge_rag_errors.IndexJobActiveError,
                create_job=fake_create_job,
                find_active_job_for_document=fake_find_active_job_for_document,
                find_document_by_id_for_update=fake_find_document_by_id_for_update,
            ),
        )

    with pytest.raises(knowledge_rag_errors.IndexJobActiveError) as exc_info:
        await knowledge_rag_write.trigger_index_service(
            session,
            user_id,
            document_id,
            TriggerIndexRequest(force=True),
            collaborators=TriggerIndexCollaborators(
                create_index_job_with_guard=fake_create_index_job_with_guard,
                find_document_by_id=fake_find_document_by_id,
                run_indexing_pipeline_task=lambda **kwargs: None,
                to_job_response=lambda current_job: current_job,
            ),
        )

    assert session.rollback_called is True
    assert exc_info.value.detail["code"] == "index_job_active"
    assert exc_info.value.detail["jobId"] == str(active_job.id)


@pytest.mark.asyncio
async def test_trigger_index_service_schedules_background_pipeline(tmp_path: Path, monkeypatch) -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    document = SimpleNamespace(id=uuid.UUID(document_id), status="failed", content="", file_type="txt")
    created_at = datetime(2026, 6, 1, tzinfo=UTC)
    job = SimpleNamespace(
        id=uuid.uuid4(),
        user_id=uuid.UUID(user_id),
        document_id=uuid.UUID(document_id),
        job_type="reindex",
        status="pending",
        progress=0,
        error_json=None,
        started_at=None,
        completed_at=None,
        created_at=created_at,
    )
    scheduled: list[dict] = []

    async def fake_find_document_by_id(current_session, requested_user_id, requested_document_id):
        del current_session
        assert requested_user_id == user_id
        assert requested_document_id == document_id
        return document

    async def fake_find_document_by_id_for_update(current_session, requested_user_id, requested_document_id):
        del current_session
        assert requested_user_id == user_id
        assert requested_document_id == document_id
        return document

    async def fake_find_active_job_for_document(current_session, requested_user_id, requested_document_id):
        del current_session
        assert requested_user_id == user_id
        assert requested_document_id == document_id
        return None

    async def fake_create_job(
        current_session,
        requested_user_id,
        *,
        document_id=None,
        job_type,
        status="pending",
        progress=0,
        error=None,
    ):
        del current_session, error
        assert requested_user_id == user_id
        assert document_id == str(document.id)
        assert job_type == "reindex"
        assert status == "pending"
        assert progress == 0
        return job

    async def fake_create_index_job_with_guard(current_session, requested_user_id, requested_document_id, *, job_type):
        return await knowledge_rag_ingest.create_index_job_with_guard(
            current_session,
            requested_user_id,
            requested_document_id,
            job_type=job_type,
            collaborators=CreateIndexJobCollaborators(
                index_job_active_error=knowledge_rag_errors.IndexJobActiveError,
                create_job=fake_create_job,
                find_active_job_for_document=fake_find_active_job_for_document,
                find_document_by_id_for_update=fake_find_document_by_id_for_update,
            ),
        )

    async def fake_run_indexing_pipeline_task(**kwargs):
        scheduled.append(kwargs)

    monkeypatch.setattr(knowledge_rag_write.asyncio, "create_task", _run_task_coro)

    result = await knowledge_rag_write.trigger_index_service(
        object(),
        user_id,
        document_id,
        TriggerIndexRequest(force=True),
        settings=Settings(
            database_url="postgresql://user:pass@localhost:5432/table",
            rag_upload_dir=str(tmp_path),
        ),
        collaborators=TriggerIndexCollaborators(
            create_index_job_with_guard=fake_create_index_job_with_guard,
            find_document_by_id=fake_find_document_by_id,
            run_indexing_pipeline_task=fake_run_indexing_pipeline_task,
            to_job_response=lambda current_job: current_job,
        ),
    )

    await asyncio.sleep(0)

    assert str(result["job"].id) == str(job.id)
    assert scheduled == [
        {
            "user_id": user_id,
            "document_id": document_id,
            "job_id": str(job.id),
            "file_type": "txt",
            "settings": Settings(
                database_url="postgresql://user:pass@localhost:5432/table",
                rag_upload_dir=str(tmp_path),
            ),
        }
    ]


@pytest.mark.asyncio
async def test_upload_document_service_keeps_saved_file_for_retry(monkeypatch, tmp_path: Path) -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    document = _build_document(document_id, content="Recovered content from file", status="failed")
    job = _build_job(document_id)
    upload = UploadFile(filename="notes.txt", file=BytesIO(b"Recovered content from file"))

    async def fake_create_document(current_session, requested_user_id, payload):
        del current_session
        assert requested_user_id == user_id
        assert str(payload["id"]) == document_id
        return document

    async def fake_create_job(
        current_session,
        requested_user_id,
        *,
        document_id=None,
        job_type,
        status="pending",
        progress=0,
        error=None,
    ):
        del current_session, error
        assert requested_user_id == user_id
        assert document_id == str(document.id)
        assert job_type == "full_index"
        assert status == "pending"
        assert progress == 0
        return job

    monkeypatch.setattr(knowledge_rag_write.asyncio, "create_task", _close_task_coro)

    result = await knowledge_rag_write.upload_document_service(
        object(),
        user_id,
        file=upload,
        title="notes",
        tags=[],
        settings=Settings(
            database_url="postgresql://user:pass@localhost:5432/table",
            rag_upload_dir=str(tmp_path),
        ),
        collaborators=_upload_collaborators(
            create_document=fake_create_document,
            create_job=fake_create_job,
            uuid4=lambda: uuid.UUID(document_id),
        ),
    )

    saved_file = tmp_path / user_id / f"{document_id}.txt"
    assert result["document"].id == document_id
    assert saved_file.exists() is True


@pytest.mark.asyncio
async def test_upload_document_service_falls_back_to_local_pdf_text_when_ocr_is_unavailable(monkeypatch) -> None:
    raw_bytes = b"%PDF-1.4 fake payload"
    recovered_text = "Recovered PDF text from local parser"

    class _FakeOcrClient:
        def __init__(self, settings) -> None:
            del settings

        async def is_available(self) -> bool:
            return False

    monkeypatch.setattr(knowledge_rag_ingest, "OCRServiceClient", _FakeOcrClient)

    content, metadata, parse_quality, has_ocr = await knowledge_rag_ingest.extract_upload_content(
        file_path=Path("report.pdf"),
        file_type="pdf",
        raw_bytes=raw_bytes,
        settings=Settings(
            database_url="postgresql://user:pass@localhost:5432/table",
            ocr_enabled=True,
        ),
        collaborators=knowledge_rag_ingest.ExtractUploadContentCollaborators(
            assemble_ocr_text=lambda payload: "",
            decode_text_content=knowledge_rag_ingest.decode_text_content,
            extract_pdf_text_locally=lambda payload: recovered_text,
            logger=SimpleNamespace(warning=lambda *args, **kwargs: None),
        ),
    )

    assert content == recovered_text
    assert metadata == {"parseMethod": "pdf_text", "ocrError": "OCR service unavailable"}
    assert parse_quality == "pdf_text"
    assert has_ocr is False


@pytest.mark.asyncio
async def test_upload_document_service_decodes_gb18030_text_files() -> None:
    recovered_text = "这是一个中文文本文件"

    content, metadata, parse_quality, has_ocr = await knowledge_rag_ingest.extract_upload_content(
        file_path=Path("report.txt"),
        file_type="txt",
        raw_bytes=recovered_text.encode("gb18030"),
        settings=Settings(database_url="postgresql://user:pass@localhost:5432/table"),
        collaborators=knowledge_rag_ingest.ExtractUploadContentCollaborators(
            assemble_ocr_text=lambda payload: "",
            decode_text_content=knowledge_rag_ingest.decode_text_content,
            extract_pdf_text_locally=lambda raw_bytes: "",
            logger=SimpleNamespace(warning=lambda *args, **kwargs: None),
        ),
    )

    assert content == recovered_text
    assert metadata == {"textEncoding": "gb18030"}
    assert parse_quality == "direct"
    assert has_ocr is False


@pytest.mark.asyncio
async def test_execute_indexing_pipeline_keeps_document_indexed_when_embedding_request_fails() -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    document = _build_document(
        document_id,
        content="已解析内容",
        status="pending",
        file_type="txt",
        source="report.txt",
    )
    job = _build_job(document_id)
    job.status = "pending"
    job.progress = 0
    job.error_json = None
    chunk = {
        "id": uuid.uuid4(),
        "content": "已解析内容",
        "contentHash": "chunk-hash",
        "chunkIndex": 0,
        "startPos": 0,
        "endPos": 5,
        "chunkType": "small",
        "parentId": None,
        "headingChain": None,
        "headingLevel": None,
        "embeddingDimensions": None,
        "embeddingVersion": None,
    }
    document_statuses: list[str] = []
    job_updates: list[tuple[str, int | None, dict | None]] = []

    async def fake_update_job_status(current_session, requested_user_id, job_id, *, status, progress=None, error=None):
        del current_session
        assert requested_user_id == user_id
        assert job_id == str(job.id)
        job.status = status
        job.progress = progress
        job.error_json = error
        job_updates.append((status, progress, error))
        return job

    async def fake_update_document(current_session, requested_user_id, requested_document_id, payload):
        del current_session
        assert requested_user_id == user_id
        assert requested_document_id == document_id
        if "status" in payload:
            document.status = payload["status"]
            document_statuses.append(payload["status"])
        if "summary" in payload:
            document.summary = payload["summary"]
        return document

    async def fake_delete_chunks_by_document(current_session, requested_user_id, requested_document_id):
        del current_session
        assert requested_user_id == user_id
        assert requested_document_id == document_id
        return 0

    async def fake_create_chunks(current_session, requested_user_id, requested_document_id, chunks):
        del current_session
        assert requested_user_id == user_id
        assert requested_document_id == document_id
        assert len(chunks) == 1
        return 1

    async def fake_apply_chunk_embeddings(
        current_session,
        requested_user_id,
        chunks,
        *,
        settings,
        runtime_config=None,
        require_provider=False,
        skip_cache_lookup=False,
    ):
        del current_session, chunks, settings, runtime_config, require_provider, skip_cache_lookup
        assert requested_user_id == user_id
        raise RuntimeError("Embedding request failed: HTTP 413")

    async def fake_embedding_provider_available(current_session, requested_user_id, settings=None):
        del current_session, settings
        assert requested_user_id == user_id
        return True

    updated_document, updated_job = await knowledge_rag_write.execute_indexing_pipeline(
        object(),
        user_id,
        document=document,
        job=job,
        content="已解析内容",
        file_type="txt",
        settings=Settings(database_url="postgresql://user:pass@localhost:5432/table"),
        collaborators=ExecuteIndexingPipelineCollaborators(
            apply_chunk_embeddings=fake_apply_chunk_embeddings,
            is_soft_embedding_failure=knowledge_rag_embedding_support.is_soft_embedding_failure,
            chunk_document_content=lambda content, file_type: [chunk],
            create_chunks=fake_create_chunks,
            delete_chunks_by_document=fake_delete_chunks_by_document,
            embedding_provider_available=fake_embedding_provider_available,
            update_document=fake_update_document,
            update_job_status=fake_update_job_status,
        ),
    )

    assert updated_document.status == "indexed"
    assert updated_job.status == "completed"
    assert updated_job.error_json == {"message": "Embedding request failed: HTTP 413"}
    assert document_statuses == ["processing", "indexed"]
    assert ("running", 80, {"message": "Embedding request failed: HTTP 413"}) in job_updates
    assert ("completed", 100, {"message": "Embedding request failed: HTTP 413"}) in job_updates


@pytest.mark.asyncio
async def test_execute_indexing_pipeline_embeds_only_small_chunks() -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    document = _build_document(
        document_id,
        content="已解析内容",
        status="pending",
        file_type="txt",
        source="report.txt",
    )
    job = _build_job(document_id)
    small_chunk = {
        "id": uuid.uuid4(),
        "content": "small chunk",
        "contentHash": "small-hash",
        "chunkIndex": 0,
        "startPos": 0,
        "endPos": 11,
        "chunkType": "small",
        "parentId": uuid.uuid4(),
        "headingChain": None,
        "headingLevel": None,
        "embeddingDimensions": None,
        "embeddingVersion": None,
    }
    parent_chunk = {
        "id": uuid.uuid4(),
        "content": "parent chunk content",
        "contentHash": "parent-hash",
        "chunkIndex": 1,
        "startPos": 0,
        "endPos": 19,
        "chunkType": "parent",
        "parentId": None,
        "headingChain": None,
        "headingLevel": None,
        "embeddingDimensions": None,
        "embeddingVersion": None,
    }

    async def fake_update_job_status(*args, **kwargs):
        return job

    async def fake_update_document(*args, **kwargs):
        return document

    async def fake_delete_chunks_by_document(*args, **kwargs):
        return 0

    async def fake_create_chunks(current_session, requested_user_id, requested_document_id, chunks):
        del current_session
        assert requested_user_id == user_id
        assert requested_document_id == document_id
        assert len(chunks) == 2
        return 2

    async def fake_apply_chunk_embeddings(
        current_session,
        requested_user_id,
        chunks,
        *,
        settings,
        runtime_config=None,
        require_provider=False,
        skip_cache_lookup=False,
    ):
        del current_session, settings, runtime_config, require_provider, skip_cache_lookup
        assert requested_user_id == user_id
        assert [chunk["chunkType"] for chunk in chunks] == ["small"]
        return 1

    async def fake_embedding_provider_available(*args, **kwargs):
        return True

    await knowledge_rag_write.execute_indexing_pipeline(
        object(),
        user_id,
        document=document,
        job=job,
        content="已解析内容",
        file_type="txt",
        settings=Settings(database_url="postgresql://user:pass@localhost:5432/table"),
        collaborators=ExecuteIndexingPipelineCollaborators(
            apply_chunk_embeddings=fake_apply_chunk_embeddings,
            is_soft_embedding_failure=knowledge_rag_embedding_support.is_soft_embedding_failure,
            chunk_document_content=lambda content, file_type: [chunk],
            create_chunks=fake_create_chunks,
            delete_chunks_by_document=fake_delete_chunks_by_document,
            embedding_provider_available=fake_embedding_provider_available,
            update_document=fake_update_document,
            update_job_status=fake_update_job_status,
        ),
    )


@pytest.mark.asyncio
async def test_execute_indexing_pipeline_skips_embedding_cache_lookup_for_reindex() -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    document = _build_document(
        document_id,
        content="已解析内容",
        status="pending",
        file_type="txt",
        source="report.txt",
    )
    job = _build_job(document_id)
    job.job_type = "reindex"
    job.status = "pending"
    job.error_json = None
    observed_skip_cache_lookup: list[bool] = []
    chunk = {
        "id": uuid.uuid4(),
        "content": "small chunk",
        "contentHash": "small-hash",
        "chunkIndex": 0,
        "startPos": 0,
        "endPos": 11,
        "chunkType": "small",
        "parentId": None,
        "headingChain": None,
        "headingLevel": None,
        "embeddingDimensions": None,
        "embeddingVersion": None,
    }

    async def fake_update_job_status(*args, **kwargs):
        return job

    async def fake_update_document(*args, **kwargs):
        return document

    async def fake_delete_chunks_by_document(*args, **kwargs):
        return 0

    async def fake_create_chunks(*args, **kwargs):
        return 1

    async def fake_apply_chunk_embeddings(
        current_session,
        requested_user_id,
        chunks,
        *,
        settings,
        runtime_config=None,
        require_provider=False,
        skip_cache_lookup=False,
    ):
        del current_session, settings, runtime_config, require_provider
        assert requested_user_id == user_id
        assert len(chunks) == 1
        observed_skip_cache_lookup.append(skip_cache_lookup)
        return 1

    async def fake_embedding_provider_available(*args, **kwargs):
        return True

    await knowledge_rag_write.execute_indexing_pipeline(
        object(),
        user_id,
        document=document,
        job=job,
        content="已解析内容",
        file_type="txt",
        settings=Settings(database_url="postgresql://user:pass@localhost:5432/table"),
        collaborators=ExecuteIndexingPipelineCollaborators(
            apply_chunk_embeddings=fake_apply_chunk_embeddings,
            is_soft_embedding_failure=knowledge_rag_embedding_support.is_soft_embedding_failure,
            chunk_document_content=lambda content, file_type: [chunk],
            create_chunks=fake_create_chunks,
            delete_chunks_by_document=fake_delete_chunks_by_document,
            embedding_provider_available=fake_embedding_provider_available,
            update_document=fake_update_document,
            update_job_status=fake_update_job_status,
        ),
    )

    assert observed_skip_cache_lookup == [True]
