from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
import uuid

import pytest
from fastapi import UploadFile

from app.core.config import Settings
from app.schemas.knowledge_rag import TriggerIndexRequest
from app.services import knowledge_rag


class _RollbackSession:
    def __init__(self) -> None:
        self.rollback_called = False

    async def rollback(self) -> None:
        self.rollback_called = True


def _build_document(
    document_id: str,
    *,
    title: str = "Test Doc",
    status: str = "pending",
    content: str = "",
    file_type: str = "txt",
    source: str = "notes.txt",
) -> SimpleNamespace:
    timestamp = datetime(2026, 6, 1, tzinfo=timezone.utc)
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
    created_at = datetime(2026, 6, 1, tzinfo=timezone.utc)
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


@pytest.mark.asyncio
async def test_trigger_index_service_rejects_active_job(monkeypatch) -> None:
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

    monkeypatch.setattr(knowledge_rag, "find_document_by_id", fake_find_document_by_id)
    monkeypatch.setattr(knowledge_rag, "find_document_by_id_for_update", fake_find_document_by_id_for_update)
    monkeypatch.setattr(knowledge_rag, "find_active_job_for_document", fake_find_active_job_for_document)

    with pytest.raises(knowledge_rag.IndexJobActiveError) as exc_info:
        await knowledge_rag.trigger_index_service(
            session,
            user_id,
            document_id,
            TriggerIndexRequest(force=True),
        )

    assert session.rollback_called is True
    assert exc_info.value.detail["code"] == "index_job_active"
    assert exc_info.value.detail["jobId"] == str(active_job.id)


@pytest.mark.asyncio
async def test_trigger_index_service_reloads_saved_file_when_document_content_is_empty(monkeypatch, tmp_path: Path) -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    document = SimpleNamespace(id=uuid.UUID(document_id), status="failed", content="", file_type="txt")
    created_at = datetime(2026, 6, 1, tzinfo=timezone.utc)
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
    upload_dir = tmp_path / user_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved_file = upload_dir / f"{document_id}.txt"
    saved_file.write_text("Recovered content from file", encoding="utf-8")

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

    async def fake_create_job(current_session, requested_user_id, *, document_id=None, job_type, status="pending", progress=0, error=None):
        del current_session, error
        assert requested_user_id == user_id
        assert document_id == str(document.id)
        assert job_type == "reindex"
        assert status == "pending"
        assert progress == 0
        return job

    async def fake_execute_indexing_pipeline(current_session, requested_user_id, *, document, job, content, file_type, settings=None):
        del current_session, settings
        assert requested_user_id == user_id
        assert content == "Recovered content from file"
        assert file_type == "txt"
        return document, job

    monkeypatch.setattr(knowledge_rag, "find_document_by_id", fake_find_document_by_id)
    monkeypatch.setattr(knowledge_rag, "find_document_by_id_for_update", fake_find_document_by_id_for_update)
    monkeypatch.setattr(knowledge_rag, "find_active_job_for_document", fake_find_active_job_for_document)
    monkeypatch.setattr(knowledge_rag, "create_job", fake_create_job)
    monkeypatch.setattr(knowledge_rag, "execute_indexing_pipeline", fake_execute_indexing_pipeline)

    result = await knowledge_rag.trigger_index_service(
        object(),
        user_id,
        document_id,
        TriggerIndexRequest(force=True),
        settings=Settings(
            database_url="postgresql://user:pass@localhost:5432/table",
            rag_upload_dir=str(tmp_path),
        ),
    )

    assert result["job"].id == str(job.id)
    assert saved_file.exists() is True


@pytest.mark.asyncio
async def test_upload_document_service_keeps_saved_file_for_retry(monkeypatch, tmp_path: Path) -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    document = _build_document(document_id, content="Recovered content from file", status="failed")
    job = _build_job(document_id)
    upload = UploadFile(filename="notes.txt", file=BytesIO(b"Recovered content from file"))

    monkeypatch.setattr(knowledge_rag, "uuid4", lambda: uuid.UUID(document_id))

    async def fake_extract_upload_content(*, file_path, file_type, raw_bytes, settings):
        del file_path, file_type, raw_bytes, settings
        return "Recovered content from file", None, "direct", False

    async def fake_create_document(current_session, requested_user_id, payload):
        del current_session
        assert requested_user_id == user_id
        assert str(payload["id"]) == document_id
        return document

    async def fake_create_job(current_session, requested_user_id, *, document_id=None, job_type, status="pending", progress=0, error=None):
        del current_session, error
        assert requested_user_id == user_id
        assert document_id == str(document.id)
        assert job_type == "full_index"
        assert status == "pending"
        assert progress == 0
        return job

    async def fake_execute_indexing_pipeline(current_session, requested_user_id, *, document, job, content, file_type, settings=None):
        del current_session, settings
        assert requested_user_id == user_id
        assert content == "Recovered content from file"
        assert file_type == "txt"
        return document, job

    monkeypatch.setattr(knowledge_rag, "_extract_upload_content", fake_extract_upload_content)
    monkeypatch.setattr(knowledge_rag, "create_document", fake_create_document)
    monkeypatch.setattr(knowledge_rag, "create_job", fake_create_job)
    monkeypatch.setattr(knowledge_rag, "execute_indexing_pipeline", fake_execute_indexing_pipeline)

    result = await knowledge_rag.upload_document_service(
        object(),
        user_id,
        file=upload,
        title="notes",
        tags=[],
        settings=Settings(
            database_url="postgresql://user:pass@localhost:5432/table",
            rag_upload_dir=str(tmp_path),
        ),
    )

    saved_file = tmp_path / user_id / f"{document_id}.txt"
    assert result["document"].id == document_id
    assert saved_file.exists() is True


@pytest.mark.asyncio
async def test_upload_document_service_falls_back_to_local_pdf_text_when_ocr_is_unavailable(
    monkeypatch,
    tmp_path: Path,
) -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    recovered_text = "Recovered PDF text from local parser"
    document = _build_document(
        document_id,
        content=recovered_text,
        status="indexed",
        file_type="pdf",
        source="report.pdf",
    )
    job = _build_job(document_id)
    upload = UploadFile(filename="report.pdf", file=BytesIO(b"%PDF-1.4 fake payload"))

    monkeypatch.setattr(knowledge_rag, "uuid4", lambda: uuid.UUID(document_id))

    class _FakeOcrClient:
        def __init__(self, settings) -> None:
            del settings

        async def is_available(self) -> bool:
            return False

    async def fake_create_document(current_session, requested_user_id, payload):
        del current_session
        assert requested_user_id == user_id
        # fire-and-forget: 同步阶段 content 尚未抽取
        assert payload["content"] == ""
        assert payload["fileType"] == "pdf"
        assert payload["status"] == "pending"
        return document

    async def fake_create_job(current_session, requested_user_id, *, document_id=None, job_type, status="pending", progress=0, error=None):
        del current_session, error
        assert requested_user_id == user_id
        assert document_id == str(document.id)
        assert job_type == "full_index"
        assert status == "pending"
        assert progress == 0
        return job

    async def fake_execute_indexing_pipeline(current_session, requested_user_id, *, document, job, content, file_type, settings=None):
        # fire-and-forget 后此函数在异步 task 里；测试不直接调用
        return document, job

    monkeypatch.setattr(knowledge_rag, "OCRServiceClient", _FakeOcrClient)
    monkeypatch.setattr(knowledge_rag, "_extract_pdf_text_locally", lambda raw_bytes: recovered_text)
    monkeypatch.setattr(knowledge_rag, "create_document", fake_create_document)
    monkeypatch.setattr(knowledge_rag, "create_job", fake_create_job)
    monkeypatch.setattr(knowledge_rag, "execute_indexing_pipeline", fake_execute_indexing_pipeline)

    result = await knowledge_rag.upload_document_service(
        object(),
        user_id,
        file=upload,
        title="report",
        tags=[],
        settings=Settings(
            database_url="postgresql://user:pass@localhost:5432/table",
            rag_upload_dir=str(tmp_path),
            ocr_enabled=True,
        ),
    )

    saved_file = tmp_path / user_id / f"{document_id}.pdf"
    assert result["document"].id == document_id
    assert saved_file.exists() is True


@pytest.mark.asyncio
async def test_upload_document_service_decodes_gb18030_text_files(monkeypatch, tmp_path: Path) -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    recovered_text = "这是一个中文文本文件"
    document = _build_document(
        document_id,
        content=recovered_text,
        status="indexed",
        file_type="txt",
        source="report.txt",
    )
    job = _build_job(document_id)
    upload = UploadFile(filename="report.txt", file=BytesIO(recovered_text.encode("gb18030")))

    monkeypatch.setattr(knowledge_rag, "uuid4", lambda: uuid.UUID(document_id))

    async def fake_create_document(current_session, requested_user_id, payload):
        del current_session
        assert requested_user_id == user_id
        # fire-and-forget: 同步阶段 content 尚未抽取
        assert payload["content"] == ""
        assert payload["fileType"] == "txt"
        assert payload["status"] == "pending"
        return document

    async def fake_create_job(current_session, requested_user_id, *, document_id=None, job_type, status="pending", progress=0, error=None):
        del current_session, error
        assert requested_user_id == user_id
        assert document_id == str(document.id)
        assert job_type == "full_index"
        assert status == "pending"
        assert progress == 0
        return job

    async def fake_execute_indexing_pipeline(current_session, requested_user_id, *, document, job, content, file_type, settings=None):
        # fire-and-forget 后此函数在异步 task 里；测试不直接调用
        return document, job

    monkeypatch.setattr(knowledge_rag, "create_document", fake_create_document)
    monkeypatch.setattr(knowledge_rag, "create_job", fake_create_job)
    monkeypatch.setattr(knowledge_rag, "execute_indexing_pipeline", fake_execute_indexing_pipeline)

    result = await knowledge_rag.upload_document_service(
        object(),
        user_id,
        file=upload,
        title="report",
        tags=[],
        settings=Settings(
            database_url="postgresql://user:pass@localhost:5432/table",
            rag_upload_dir=str(tmp_path),
        ),
    )

    saved_file = tmp_path / user_id / f"{document_id}.txt"
    assert result["document"].id == document_id
    assert saved_file.exists() is True


@pytest.mark.asyncio
async def test_execute_indexing_pipeline_keeps_document_indexed_when_embedding_request_fails(monkeypatch) -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    document = _build_document(document_id, content="已解析内容", status="pending", file_type="txt", source="report.txt")
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

    async def fake_apply_chunk_embeddings(current_session, requested_user_id, chunks, *, settings, runtime_config=None, require_provider=False):
        del current_session, chunks, settings, runtime_config, require_provider
        assert requested_user_id == user_id
        raise RuntimeError("Embedding request failed: HTTP 413")

    async def fake_embedding_provider_available(current_session, requested_user_id, settings=None):
        del current_session, settings
        assert requested_user_id == user_id
        return True

    monkeypatch.setattr(knowledge_rag, "update_job_status", fake_update_job_status)
    monkeypatch.setattr(knowledge_rag, "update_document", fake_update_document)
    monkeypatch.setattr(knowledge_rag, "delete_chunks_by_document", fake_delete_chunks_by_document)
    monkeypatch.setattr(knowledge_rag, "create_chunks", fake_create_chunks)
    monkeypatch.setattr(knowledge_rag, "_apply_chunk_embeddings", fake_apply_chunk_embeddings)
    monkeypatch.setattr(knowledge_rag, "embedding_provider_available", fake_embedding_provider_available)
    monkeypatch.setattr(knowledge_rag, "chunk_document_content", lambda content, file_type: [chunk])

    updated_document, updated_job = await knowledge_rag.execute_indexing_pipeline(
        object(),
        user_id,
        document=document,
        job=job,
        content="已解析内容",
        file_type="txt",
        settings=Settings(
            database_url="postgresql://user:pass@localhost:5432/table",
        ),
    )

    assert updated_document.status == "indexed"
    assert updated_job.status == "completed"
    assert updated_job.error_json == {"message": "Embedding request failed: HTTP 413"}
    assert document_statuses == ["processing", "indexed"]
    assert ("running", 80, {"message": "Embedding request failed: HTTP 413"}) in job_updates
    assert ("completed", 100, {"message": "Embedding request failed: HTTP 413"}) in job_updates


@pytest.mark.asyncio
async def test_execute_indexing_pipeline_embeds_only_small_chunks(monkeypatch) -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    document_id = str(uuid.uuid4())
    document = _build_document(document_id, content="已解析内容", status="pending", file_type="txt", source="report.txt")
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

    async def fake_apply_chunk_embeddings(current_session, requested_user_id, chunks, *, settings, runtime_config=None, require_provider=False):
        del current_session, settings, runtime_config, require_provider
        assert requested_user_id == user_id
        assert [chunk["chunkType"] for chunk in chunks] == ["small"]
        return 1

    async def fake_embedding_provider_available(*args, **kwargs):
        return True

    monkeypatch.setattr(knowledge_rag, "update_job_status", fake_update_job_status)
    monkeypatch.setattr(knowledge_rag, "update_document", fake_update_document)
    monkeypatch.setattr(knowledge_rag, "delete_chunks_by_document", fake_delete_chunks_by_document)
    monkeypatch.setattr(knowledge_rag, "create_chunks", fake_create_chunks)
    monkeypatch.setattr(knowledge_rag, "_apply_chunk_embeddings", fake_apply_chunk_embeddings)
    monkeypatch.setattr(knowledge_rag, "embedding_provider_available", fake_embedding_provider_available)
    monkeypatch.setattr(knowledge_rag, "chunk_document_content", lambda content, file_type: [small_chunk, parent_chunk])

    await knowledge_rag.execute_indexing_pipeline(
        object(),
        user_id,
        document=document,
        job=job,
        content="已解析内容",
        file_type="txt",
        settings=Settings(database_url="postgresql://user:pass@localhost:5432/table"),
    )
