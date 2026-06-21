from __future__ import annotations

from io import BytesIO
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import REPO_ROOT, Settings
from app.db.models import KnowledgeDocument, KnowledgeIndexJob
from app.integrations.ocr_service import OCRServiceClient, OCRServiceSettings
from app.services.knowledge_rag_collaborators import (
    CreateIndexJobCollaborators,
    ExtractUploadContentCollaborators,
    LoadDocumentContentCollaborators,
)

ACTIVE_INDEX_JOB_STATUSES = {"pending", "running"}
_VALID_CHAR_CATEGORIES = frozenset({"L", "N", "P", "S", "Z"})
_ZERO_WIDTH_CHARS = frozenset({"​", "‌", "‍", "﻿", "­"})


def default_upload_dir(settings: Settings) -> Path:
    return Path(settings.rag_upload_dir) if settings.rag_upload_dir else REPO_ROOT / "server" / "data" / "uploads"


def document_upload_dir(settings: Settings, user_id: str) -> Path:
    return default_upload_dir(settings) / user_id


def find_uploaded_document_path(settings: Settings, user_id: str, document_id: str) -> Path | None:
    upload_dir = document_upload_dir(settings, user_id)
    for path in sorted(upload_dir.glob(f"{document_id}.*")):
        if path.is_file():
            return path
    return None


def extension_to_file_type(filename: str) -> str | None:
    return {
        ".pdf": "pdf",
        ".md": "md",
        ".markdown": "markdown",
        ".txt": "txt",
    }.get(Path(filename).suffix.lower())


def assemble_ocr_text(payload: dict) -> str:
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


def decode_text_content(raw_bytes: bytes) -> tuple[str, str]:
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


def extract_pdf_text_locally(raw_bytes: bytes) -> str:
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


def count_valid_chars(text: str) -> int:
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


def preflight_pdf_quality(raw_bytes: bytes, settings: Settings) -> tuple[bool, str, dict]:
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
        valid_chars += count_valid_chars(page_text)

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


async def extract_upload_content(
    *,
    file_path: Path,
    file_type: str,
    raw_bytes: bytes,
    settings: Settings,
    collaborators: ExtractUploadContentCollaborators,
) -> tuple[str, dict | None, str | None, bool]:
    if file_type in {"txt", "md", "markdown"}:
        content, encoding = collaborators.decode_text_content(raw_bytes)
        return content, {"textEncoding": encoding}, "direct", False

    if file_type == "pdf":
        from app.services.knowledge_rag_pdf import extract_pdf_with_images

        probe_text = collaborators.extract_pdf_text_locally(raw_bytes)
        scan_like = bool(probe_text) and len(probe_text) < settings.rag_quality_scan_detection_chars
        is_scan = not probe_text or scan_like

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
                    ocr_text = collaborators.assemble_ocr_text(payload)
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
                collaborators.logger.warning("MarkItDown path failed, falling back to OCR: %s", exc)
                return await _ocr_fallback()

        if probe_text and len(probe_text) >= settings.rag_pdf_text_fast_path_min_chars:
            return probe_text, {"parseMethod": "pdf_text_fast_path"}, "pdf_text", False

        return await _ocr_fallback()

    return "", None, None, False


async def load_document_content_for_indexing(
    session: AsyncSession,
    user_id: str,
    document: KnowledgeDocument,
    *,
    settings: Settings,
    collaborators: LoadDocumentContentCollaborators,
) -> tuple[str, str | None]:
    del session
    if (document.content or "").strip():
        return document.content or "", document.file_type

    file_path = collaborators.find_uploaded_document_path(settings, user_id, str(document.id))
    if file_path is None:
        return "", document.file_type

    raw_bytes = file_path.read_bytes()
    file_type = document.file_type or collaborators.extension_to_file_type(file_path.name)
    if file_type is None:
        return "", document.file_type

    content, _, _, _ = await collaborators.extract_upload_content(
        file_path=file_path,
        file_type=file_type,
        raw_bytes=raw_bytes,
        settings=settings,
    )
    return content, file_type


async def create_index_job_with_guard(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    *,
    job_type: str,
    collaborators: CreateIndexJobCollaborators,
) -> tuple[KnowledgeDocument, KnowledgeIndexJob]:
    document = await collaborators.find_document_by_id_for_update(session, user_id, document_id)
    if not document:
        raise ValueError("Document not found")

    active_job = await collaborators.find_active_job_for_document(session, user_id, document_id)
    if active_job and (active_job.status or "") in ACTIVE_INDEX_JOB_STATUSES:
        await session.rollback()
        raise collaborators.index_job_active_error(active_job)

    job = await collaborators.create_job(
        session,
        user_id,
        document_id=document_id,
        job_type=job_type,
        status="pending",
        progress=0,
        error=None,
    )
    return document, job
