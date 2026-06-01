import json
from uuid import UUID

from app.dependencies import AuthenticatedUser, DbSession
from app.schemas.knowledge_rag import (
    BackfillEmbeddingsResponse,
    ChunkListEnvelope,
    ChunkListQuery,
    DocumentListEnvelope,
    DocumentListQuery,
    HybridSearchRequest,
    JobListEnvelope,
    JobListQuery,
    OCRHealthResponse,
    RagStatsResponse,
    TriggerIndexRequest,
    UpdateDocumentRequest,
)
from app.services.knowledge_rag import (
    backfill_embeddings_service,
    delete_document_service,
    get_chunks,
    get_document,
    get_documents,
    get_job,
    get_jobs,
    get_ocr_health,
    get_stats,
    search_service,
    search_with_context_service,
    trigger_index_service,
    update_document_service,
    upload_document_service,
)
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status

router = APIRouter(prefix="/knowledge-rag")


def not_implemented(detail: str) -> HTTPException:
    return HTTPException(status_code=501, detail={"error": "NOT_IMPLEMENTED", "message": detail})


def _split_csv_values(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        result.extend([item.strip() for item in value.split(",") if item.strip()])
    return result


def parse_upload_tags(raw_tags: str | None) -> list[str]:
    if not raw_tags:
        return []
    try:
        payload = json.loads(raw_tags)
    except json.JSONDecodeError:
        return []
    return [item for item in payload if isinstance(item, str)] if isinstance(payload, list) else []


def parse_document_list_query(request: Request) -> DocumentListQuery:
    return DocumentListQuery.model_validate(
        {
            "status": request.query_params.get("status"),
            "fileType": request.query_params.get("fileType"),
            "tags": _split_csv_values(request.query_params.getlist("tags")) or None,
            "publishDateStart": request.query_params.get("publishDateStart"),
            "publishDateEnd": request.query_params.get("publishDateEnd"),
            "sourceDept": _split_csv_values(request.query_params.getlist("sourceDept")) or None,
            "securityLevel": request.query_params.get("securityLevel"),
            "businessCategory": _split_csv_values(request.query_params.getlist("businessCategory")) or None,
            "limit": request.query_params.get("limit", 20),
            "offset": request.query_params.get("offset", 0),
        }
    )


@router.get("/documents", response_model=DocumentListEnvelope)
async def list_documents(
    query: DocumentListQuery = Depends(parse_document_list_query),
    session: DbSession = None,  # type: ignore[assignment]
    user: AuthenticatedUser = None,  # type: ignore[assignment]
) -> DocumentListEnvelope:
    items, total = await get_documents(session, user.user_id, query)
    return DocumentListEnvelope(items=items, total=total)


@router.get("/documents/{document_id}")
async def get_document_detail(
    document_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
):
    document = await get_document(session, user.user_id, str(document_id))
    if not document:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Document not found"})
    return document


@router.patch("/documents/{document_id}")
async def update_document(
    document_id: UUID,
    payload: UpdateDocumentRequest,
    session: DbSession,
    user: AuthenticatedUser,
):
    document = await update_document_service(session, user.user_id, str(document_id), payload)
    if not document:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Document not found"})
    return document


@router.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    tags: str | None = Form(default=None),
    session: DbSession = None,  # type: ignore[assignment]
    user: AuthenticatedUser = None,  # type: ignore[assignment]
):
    parsed_tags = parse_upload_tags(tags)
    try:
        return await upload_document_service(
            session,
            user.user_id,
            file=file,
            title=title,
            tags=parsed_tags,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": "BAD_REQUEST", "message": str(exc)}) from exc


@router.delete("/documents/{document_id}")
async def delete_document(document_id: UUID, session: DbSession, user: AuthenticatedUser) -> Response:
    deleted = await delete_document_service(session, user.user_id, str(document_id))
    if not deleted:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Document not found"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/documents/{document_id}/index")
async def trigger_index(
    document_id: UUID,
    payload: TriggerIndexRequest,
    session: DbSession,
    user: AuthenticatedUser,
):
    try:
        return await trigger_index_service(session, user.user_id, str(document_id), payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": str(exc)}) from exc


@router.post("/documents/{document_id}/backfill", response_model=BackfillEmbeddingsResponse)
async def backfill_embeddings(
    document_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> BackfillEmbeddingsResponse:
    try:
        result = await backfill_embeddings_service(session, user.user_id, str(document_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": str(exc)}) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail={"error": "CONFLICT", "message": str(exc)}) from exc
    return BackfillEmbeddingsResponse(**result)


@router.get("/jobs", response_model=JobListEnvelope)
async def list_jobs(query: JobListQuery, session: DbSession, user: AuthenticatedUser) -> JobListEnvelope:
    items, total = await get_jobs(session, user.user_id, query)
    return JobListEnvelope(items=items, total=total)


@router.get("/jobs/{job_id}")
async def get_job_detail(job_id: UUID, session: DbSession, user: AuthenticatedUser):
    job = await get_job(session, user.user_id, str(job_id))
    if not job:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Job not found"})
    return job


@router.get("/chunks", response_model=ChunkListEnvelope)
async def list_chunks(query: ChunkListQuery, session: DbSession, user: AuthenticatedUser) -> ChunkListEnvelope:
    items, total = await get_chunks(session, user.user_id, query)
    return ChunkListEnvelope(items=items, total=total)


@router.post("/search")
async def search(
    payload: HybridSearchRequest,
    session: DbSession,
    user: AuthenticatedUser,
):
    return await search_service(session, user.user_id, payload)


@router.post("/search/context")
async def search_with_context(
    payload: HybridSearchRequest,
    session: DbSession,
    user: AuthenticatedUser,
):
    return await search_with_context_service(session, user.user_id, payload)


@router.get("/stats", response_model=RagStatsResponse)
async def stats(session: DbSession, user: AuthenticatedUser) -> RagStatsResponse:
    return await get_stats(session, user.user_id)


@router.get("/ocr/health", response_model=OCRHealthResponse)
async def ocr_health() -> OCRHealthResponse:
    return await get_ocr_health()
