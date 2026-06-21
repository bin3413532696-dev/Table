import asyncio
import logging
import re
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.knowledge_rag_embedding_support as knowledge_rag_embedding_support_service
import app.services.knowledge_rag_images as knowledge_rag_images_service
import app.services.knowledge_rag_ingest as knowledge_rag_ingest_service
import app.services.knowledge_rag_mutations as knowledge_rag_mutations_service
import app.services.knowledge_rag_query as knowledge_rag_query_service
import app.services.knowledge_rag_query_support as knowledge_rag_query_support_service
import app.services.knowledge_rag_tasks as knowledge_rag_tasks_service
import app.services.knowledge_rag_write as knowledge_rag_write_service
from app.core.config import Settings
from app.db.models import KnowledgeDocument, KnowledgeIndexJob
from app.db.session import SessionLocal
from app.repositories.knowledge_corpora import (
    create_corpus,
    delete_corpus,
    replace_corpus_documents,
    update_corpus,
)
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
    find_image_description_cache,
    find_job_by_id,
    get_chunks_without_embedding,
    store_embedding_cache,
    store_image_description_cache,
    update_chunk_embeddings_batch,
    update_document,
    update_job_status,
)
from app.schemas.knowledge_rag import (
    ChunkListQuery,
    CreateKnowledgeCorpusRequest,
    DocumentListQuery,
    IndexJobResponse,
    JobListQuery,
    KnowledgeChunkResponse,
    KnowledgeCorpusResponse,
    KnowledgeDocumentResponse,
    OCRHealthResponse,
    RagStatsResponse,
    SearchResponse,
    TriggerIndexRequest,
    UpdateDocumentRequest,
    UpdateKnowledgeCorpusRequest,
)
from app.services.knowledge_rag_collaborators import (
    BackfillEmbeddingsCollaborators,
    CreateCorpusCollaborators,
    CreateIndexJobCollaborators,
    DeleteCorpusCollaborators,
    DeleteDocumentCollaborators,
    EmbeddingSupportCollaborators,
    ExecuteIndexingPipelineCollaborators,
    ExtractUploadContentCollaborators,
    ImageDescriptionCollaborators,
    LoadDocumentContentCollaborators,
    RunIndexingPipelineTaskCollaborators,
    TriggerIndexCollaborators,
    UpdateCorpusCollaborators,
    UpdateDocumentCollaborators,
    UploadDocumentCollaborators,
)
from app.services.knowledge_rag_errors import DocumentQualityError, IndexJobActiveError
from app.services.knowledge_rag_embeddings import (
    EmbeddingChunkInput,
    EmbeddingRuntimeConfig,
    embed_chunk_batch,
    embedding_provider_available,
    format_vector_for_db,
    resolve_embedding_runtime_config,
)
from app.services.knowledge_rag_indexing import chunk_document_content
from app.services.knowledge_rag_query_support import (
    to_corpus_response,
    to_document_response,
    to_job_response,
)

logger = logging.getLogger("table-python-backend")

ACTIVE_INDEX_JOB_STATUSES = {"pending", "running"}
OCRServiceClient = knowledge_rag_ingest_service.OCRServiceClient


async def resolve_corpus_document_ids(
    session: AsyncSession,
    user_id: str,
    *,
    corpus_id: str | None,
) -> list[str]:
    return await knowledge_rag_query_service.resolve_corpus_document_ids(session, user_id, corpus_id=corpus_id)


def _is_soft_embedding_failure(exc: Exception) -> bool:
    return knowledge_rag_embedding_support_service.is_soft_embedding_failure(exc)


async def _apply_chunk_embeddings(
    session: AsyncSession,
    user_id: str,
    chunks: list[dict],
    *,
    settings: Settings,
    runtime_config: EmbeddingRuntimeConfig | None = None,
    require_provider: bool = False,
    skip_cache_lookup: bool = False,
) -> int:
    return await knowledge_rag_embedding_support_service.apply_chunk_embeddings(
        session,
        user_id,
        chunks,
        settings=settings,
        runtime_config=runtime_config,
        require_provider=require_provider,
        skip_cache_lookup=skip_cache_lookup,
        collaborators=EmbeddingSupportCollaborators(
            embedding_chunk_input=EmbeddingChunkInput,
            embed_chunk_batch=embed_chunk_batch,
            find_embedding_cache_batch=find_embedding_cache_batch,
            format_vector_for_db=format_vector_for_db,
            resolve_embedding_runtime_config=resolve_embedding_runtime_config,
            store_embedding_cache=store_embedding_cache,
            update_chunk_embeddings_batch=update_chunk_embeddings_batch,
        ),
    )


def build_search_context(results, max_chars: int = 4000) -> str:
    return knowledge_rag_query_service.build_search_context(results, max_chars=max_chars)


_score_keyword_candidate = knowledge_rag_query_support_service._score_keyword_candidate
_fuse_search_results = knowledge_rag_query_support_service._fuse_search_results


async def get_documents(
    session: AsyncSession,
    user_id: str,
    query: DocumentListQuery,
) -> tuple[list[KnowledgeDocumentResponse], int]:
    return await knowledge_rag_query_service.get_documents(session, user_id, query)


async def get_document(session: AsyncSession, user_id: str, document_id: str) -> KnowledgeDocumentResponse | None:
    return await knowledge_rag_query_service.get_document(session, user_id, document_id)


async def get_corpora(session: AsyncSession, user_id: str) -> tuple[list[KnowledgeCorpusResponse], int]:
    return await knowledge_rag_query_service.get_corpora(session, user_id)


async def get_corpus(session: AsyncSession, user_id: str, corpus_id: str) -> KnowledgeCorpusResponse | None:
    return await knowledge_rag_query_service.get_corpus(session, user_id, corpus_id)


async def create_corpus_service(
    session: AsyncSession,
    user_id: str,
    payload: CreateKnowledgeCorpusRequest,
) -> KnowledgeCorpusResponse:
    return await knowledge_rag_mutations_service.create_corpus_service(
        session,
        user_id,
        payload,
        collaborators=CreateCorpusCollaborators(
            create_corpus=create_corpus,
            get_corpus=get_corpus,
            replace_corpus_documents=replace_corpus_documents,
            to_corpus_response=to_corpus_response,
        ),
    )


async def update_corpus_service(
    session: AsyncSession,
    user_id: str,
    corpus_id: str,
    payload: UpdateKnowledgeCorpusRequest,
) -> KnowledgeCorpusResponse | None:
    return await knowledge_rag_mutations_service.update_corpus_service(
        session,
        user_id,
        corpus_id,
        payload,
        collaborators=UpdateCorpusCollaborators(
            get_corpus=get_corpus,
            replace_corpus_documents=replace_corpus_documents,
            update_corpus=update_corpus,
        ),
    )


async def delete_corpus_service(session: AsyncSession, user_id: str, corpus_id: str) -> bool:
    return await knowledge_rag_mutations_service.delete_corpus_service(
        session,
        user_id,
        corpus_id,
        collaborators=DeleteCorpusCollaborators(delete_corpus=delete_corpus),
    )


async def update_document_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    payload: UpdateDocumentRequest,
) -> KnowledgeDocumentResponse | None:
    return await knowledge_rag_mutations_service.update_document_service(
        session,
        user_id,
        document_id,
        payload,
        collaborators=UpdateDocumentCollaborators(
            to_document_response=to_document_response,
            update_document=update_document,
        ),
    )


async def get_jobs(session: AsyncSession, user_id: str, query: JobListQuery) -> tuple[list[IndexJobResponse], int]:
    return await knowledge_rag_query_service.get_jobs(session, user_id, query)


async def get_job(session: AsyncSession, user_id: str, job_id: str) -> IndexJobResponse | None:
    return await knowledge_rag_query_service.get_job(session, user_id, job_id)


async def get_chunks(
    session: AsyncSession,
    user_id: str,
    query: ChunkListQuery,
) -> tuple[list[KnowledgeChunkResponse], int]:
    return await knowledge_rag_query_service.get_chunks(session, user_id, query)


async def backfill_embeddings_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    settings: Settings | None = None,
) -> dict[str, int]:
    return await knowledge_rag_mutations_service.backfill_embeddings_service(
        session,
        user_id,
        document_id,
        settings=settings,
        collaborators=BackfillEmbeddingsCollaborators(
            apply_chunk_embeddings=_apply_chunk_embeddings,
            find_document_by_id=find_document_by_id,
            get_chunks_without_embedding=get_chunks_without_embedding,
        ),
    )


async def get_stats(session: AsyncSession, user_id: str) -> RagStatsResponse:
    return await knowledge_rag_query_service.get_stats(session, user_id)


async def get_ocr_health(settings: Settings | None = None) -> OCRHealthResponse:
    return await knowledge_rag_query_service.get_ocr_health(settings=settings)


async def search_service(
    session: AsyncSession,
    user_id: str,
    payload,
    settings: Settings | None = None,
) -> SearchResponse:
    return await knowledge_rag_query_service.search_service(session, user_id, payload, settings=settings)


async def search_with_context_service(
    session: AsyncSession,
    user_id: str,
    payload,
    settings: Settings | None = None,
) -> dict:
    return await knowledge_rag_query_service.search_with_context_service(session, user_id, payload, settings=settings)


def _default_upload_dir(settings: Settings) -> Path:
    return knowledge_rag_ingest_service.default_upload_dir(settings)


def _document_upload_dir(settings: Settings, user_id: str) -> Path:
    return knowledge_rag_ingest_service.document_upload_dir(settings, user_id)


def _find_uploaded_document_path(settings: Settings, user_id: str, document_id: str) -> Path | None:
    return knowledge_rag_ingest_service.find_uploaded_document_path(settings, user_id, document_id)


def _extension_to_file_type(filename: str) -> str | None:
    return knowledge_rag_ingest_service.extension_to_file_type(filename)


def _assemble_ocr_text(payload: dict) -> str:
    return knowledge_rag_ingest_service.assemble_ocr_text(payload)


def _decode_text_content(raw_bytes: bytes) -> tuple[str, str]:
    return knowledge_rag_ingest_service.decode_text_content(raw_bytes)


def _extract_pdf_text_locally(raw_bytes: bytes) -> str:
    return knowledge_rag_ingest_service.extract_pdf_text_locally(raw_bytes)


def _count_valid_chars(text: str) -> int:
    return knowledge_rag_ingest_service.count_valid_chars(text)


def _preflight_pdf_quality(
    raw_bytes: bytes,
    settings: Settings,
) -> tuple[bool, str, dict]:
    return knowledge_rag_ingest_service.preflight_pdf_quality(raw_bytes, settings)


async def _extract_upload_content(
    *,
    file_path: Path,
    file_type: str,
    raw_bytes: bytes,
    settings: Settings,
) -> tuple[str, dict | None, str | None, bool]:
    return await knowledge_rag_ingest_service.extract_upload_content(
        file_path=file_path,
        file_type=file_type,
        raw_bytes=raw_bytes,
        settings=settings,
        collaborators=ExtractUploadContentCollaborators(
            assemble_ocr_text=_assemble_ocr_text,
            decode_text_content=_decode_text_content,
            extract_pdf_text_locally=_extract_pdf_text_locally,
            logger=logger,
        ),
    )


async def _load_document_content_for_indexing(
    session: AsyncSession,
    user_id: str,
    document: KnowledgeDocument,
    *,
    settings: Settings,
) -> tuple[str, str | None]:
    return await knowledge_rag_ingest_service.load_document_content_for_indexing(
        session,
        user_id,
        document,
        settings=settings,
        collaborators=LoadDocumentContentCollaborators(
            extension_to_file_type=_extension_to_file_type,
            extract_upload_content=_extract_upload_content,
            find_uploaded_document_path=_find_uploaded_document_path,
        ),
    )


async def _create_index_job_with_guard(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    *,
    job_type: str,
) -> tuple[KnowledgeDocument, KnowledgeIndexJob]:
    return await knowledge_rag_ingest_service.create_index_job_with_guard(
        session,
        user_id,
        document_id,
        job_type=job_type,
        collaborators=CreateIndexJobCollaborators(
            index_job_active_error=IndexJobActiveError,
            create_job=create_job,
            find_active_job_for_document=find_active_job_for_document,
            find_document_by_id_for_update=find_document_by_id_for_update,
        ),
    )


def _image_placeholder_regex() -> re.Pattern:
    return knowledge_rag_images_service.image_placeholder_regex()


def _find_image_file(images_dir: Path, page_num: int, image_index: int) -> Path | None:
    return knowledge_rag_images_service.find_image_file(images_dir, page_num, image_index)


async def _describe_single_image_vlm(
    *,
    image_path: Path,
    runtime_config,
    semaphore: asyncio.Semaphore,
) -> str:
    return await knowledge_rag_images_service.describe_single_image_vlm(
        image_path=image_path,
        runtime_config=runtime_config,
        semaphore=semaphore,
    )


async def _describe_images_and_replace_placeholders(
    *,
    session: AsyncSession,
    user_id: str,
    document_id: str,
    content: str,
    settings: Settings,
) -> str:
    return await knowledge_rag_images_service.describe_images_and_replace_placeholders(
        session=session,
        user_id=user_id,
        document_id=document_id,
        content=content,
        settings=settings,
        collaborators=ImageDescriptionCollaborators(
            describe_single_image_vlm=_describe_single_image_vlm,
            find_image_description_cache=find_image_description_cache,
            find_image_file=_find_image_file,
            find_uploaded_document_path=_find_uploaded_document_path,
            image_placeholder_regex=_image_placeholder_regex,
            logger=logger,
            store_image_description_cache=store_image_description_cache,
        ),
    )


async def _run_indexing_pipeline_task(
    *,
    user_id: str,
    document_id: str,
    job_id: str,
    file_type: str | None,
    settings: Settings,
) -> None:
    await knowledge_rag_tasks_service.run_indexing_pipeline_task(
        user_id=user_id,
        document_id=document_id,
        job_id=job_id,
        file_type=file_type,
        settings=settings,
        collaborators=RunIndexingPipelineTaskCollaborators(
            session_local=SessionLocal,
            describe_images_and_replace_placeholders=_describe_images_and_replace_placeholders,
            load_document_content_for_indexing=_load_document_content_for_indexing,
            execute_indexing_pipeline=execute_indexing_pipeline,
            find_document_by_id=find_document_by_id,
            find_job_by_id=find_job_by_id,
            logger=logger,
            update_document=update_document,
            update_job_status=update_job_status,
        ),
    )


async def upload_document_service(
    session: AsyncSession,
    user_id: str,
    *,
    file: UploadFile,
    title: str | None,
    tags: list[str],
    settings: Settings | None = None,
) -> dict:
    return await knowledge_rag_write_service.upload_document_service(
        session,
        user_id,
        file=file,
        title=title,
        tags=tags,
        settings=settings,
        collaborators=UploadDocumentCollaborators(
            document_quality_error=DocumentQualityError,
            document_upload_dir=_document_upload_dir,
            extension_to_file_type=_extension_to_file_type,
            preflight_pdf_quality=_preflight_pdf_quality,
            run_indexing_pipeline_task=_run_indexing_pipeline_task,
            create_document=create_document,
            create_job=create_job,
            delete_document=delete_document,
            to_document_response=to_document_response,
            to_job_response=to_job_response,
            uuid4=uuid4,
        ),
    )


async def delete_document_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    settings: Settings | None = None,
) -> bool:
    return await knowledge_rag_write_service.delete_document_service(
        session,
        user_id,
        document_id,
        settings=settings,
        collaborators=DeleteDocumentCollaborators(
            document_upload_dir=_document_upload_dir,
            delete_document=delete_document,
            find_document_by_id=find_document_by_id,
        ),
    )


async def trigger_index_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    payload: TriggerIndexRequest,
    settings: Settings | None = None,
) -> dict:
    return await knowledge_rag_write_service.trigger_index_service(
        session,
        user_id,
        document_id,
        payload,
        settings=settings,
        collaborators=TriggerIndexCollaborators(
            create_index_job_with_guard=_create_index_job_with_guard,
            find_document_by_id=find_document_by_id,
            run_indexing_pipeline_task=_run_indexing_pipeline_task,
            to_job_response=to_job_response,
        ),
    )


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
    return await knowledge_rag_write_service.execute_indexing_pipeline(
        session,
        user_id,
        document=document,
        job=job,
        content=content,
        file_type=file_type,
        settings=settings,
        collaborators=ExecuteIndexingPipelineCollaborators(
            apply_chunk_embeddings=_apply_chunk_embeddings,
            is_soft_embedding_failure=_is_soft_embedding_failure,
            chunk_document_content=chunk_document_content,
            create_chunks=create_chunks,
            delete_chunks_by_document=delete_chunks_by_document,
            embedding_provider_available=embedding_provider_available,
            update_document=update_document,
            update_job_status=update_job_status,
        ),
    )
