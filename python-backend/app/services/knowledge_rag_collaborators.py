from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class CreateCorpusCollaborators:
    create_corpus: Callable[..., Awaitable[Any]]
    get_corpus: Callable[..., Awaitable[Any]]
    replace_corpus_documents: Callable[..., Awaitable[Any]]
    to_corpus_response: Callable[..., Any]


@dataclass(frozen=True)
class UpdateCorpusCollaborators:
    get_corpus: Callable[..., Awaitable[Any]]
    replace_corpus_documents: Callable[..., Awaitable[Any]]
    update_corpus: Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class DeleteCorpusCollaborators:
    delete_corpus: Callable[..., Awaitable[bool]]


@dataclass(frozen=True)
class UpdateDocumentCollaborators:
    to_document_response: Callable[..., Any]
    update_document: Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class BackfillEmbeddingsCollaborators:
    apply_chunk_embeddings: Callable[..., Awaitable[int]]
    find_document_by_id: Callable[..., Awaitable[Any]]
    get_chunks_without_embedding: Callable[..., Awaitable[list[dict[str, Any]]]]


@dataclass(frozen=True)
class EmbeddingSupportCollaborators:
    embedding_chunk_input: Callable[..., Any]
    embed_chunk_batch: Callable[..., Awaitable[list[dict[str, Any]]]]
    find_embedding_cache_batch: Callable[..., Awaitable[dict[str, str]]]
    format_vector_for_db: Callable[[list[float]], str]
    resolve_embedding_runtime_config: Callable[..., Awaitable[Any]]
    store_embedding_cache: Callable[..., Awaitable[Any]]
    update_chunk_embeddings_batch: Callable[..., Awaitable[int]]


@dataclass(frozen=True)
class UploadDocumentCollaborators:
    document_quality_error: type[Exception]
    document_upload_dir: Callable[..., Any]
    extension_to_file_type: Callable[[str], str | None]
    preflight_pdf_quality: Callable[..., tuple[bool, str, dict[str, Any]]]
    run_indexing_pipeline_task: Callable[..., Awaitable[None]]
    create_document: Callable[..., Awaitable[Any]]
    create_job: Callable[..., Awaitable[Any]]
    delete_document: Callable[..., Awaitable[Any]]
    to_document_response: Callable[..., Any]
    to_job_response: Callable[..., Any]
    uuid4: Callable[[], Any]


@dataclass(frozen=True)
class DeleteDocumentCollaborators:
    document_upload_dir: Callable[..., Any]
    delete_document: Callable[..., Awaitable[Any]]
    find_document_by_id: Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class TriggerIndexCollaborators:
    create_index_job_with_guard: Callable[..., Awaitable[tuple[Any, Any]]]
    find_document_by_id: Callable[..., Awaitable[Any]]
    run_indexing_pipeline_task: Callable[..., Awaitable[None]]
    to_job_response: Callable[..., Any]


@dataclass(frozen=True)
class ExecuteIndexingPipelineCollaborators:
    apply_chunk_embeddings: Callable[..., Awaitable[int]]
    is_soft_embedding_failure: Callable[[Exception], bool]
    chunk_document_content: Callable[[str, str | None], list[dict[str, Any]]]
    create_chunks: Callable[..., Awaitable[Any]]
    delete_chunks_by_document: Callable[..., Awaitable[Any]]
    embedding_provider_available: Callable[..., Awaitable[bool]]
    update_document: Callable[..., Awaitable[Any]]
    update_job_status: Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class RunIndexingPipelineTaskCollaborators:
    session_local: Callable[[], Any]
    describe_images_and_replace_placeholders: Callable[..., Awaitable[str]]
    load_document_content_for_indexing: Callable[..., Awaitable[tuple[str, str | None]]]
    execute_indexing_pipeline: Callable[..., Awaitable[tuple[Any, Any]]]
    find_document_by_id: Callable[..., Awaitable[Any]]
    find_job_by_id: Callable[..., Awaitable[Any]]
    logger: Any
    update_document: Callable[..., Awaitable[Any]]
    update_job_status: Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class ExtractUploadContentCollaborators:
    assemble_ocr_text: Callable[[dict[str, Any]], str]
    decode_text_content: Callable[[bytes], tuple[str, str]]
    extract_pdf_text_locally: Callable[[bytes], str]
    logger: Any


@dataclass(frozen=True)
class LoadDocumentContentCollaborators:
    extension_to_file_type: Callable[[str], str | None]
    extract_upload_content: Callable[..., Awaitable[tuple[str, dict[str, Any] | None, str | None, bool]]]
    find_uploaded_document_path: Callable[..., Any]


@dataclass(frozen=True)
class CreateIndexJobCollaborators:
    index_job_active_error: type[Exception]
    create_job: Callable[..., Awaitable[Any]]
    find_active_job_for_document: Callable[..., Awaitable[Any]]
    find_document_by_id_for_update: Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class ImageDescriptionCollaborators:
    describe_single_image_vlm: Callable[..., Awaitable[str]]
    find_image_description_cache: Callable[..., Awaitable[Any]]
    find_image_file: Callable[..., Any]
    find_uploaded_document_path: Callable[..., Any]
    image_placeholder_regex: Callable[[], Any]
    logger: Any
    store_image_description_cache: Callable[..., Awaitable[Any]]
