from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.error_mapping import http_not_found
from app.api.query_parsing import get_query_param, get_scalar_or_csv_list_query_param
from app.dependencies import AuthenticatedUser, DbSession
from app.schemas.knowledge import (
    CreateNoteRequest,
    CreatePresetTagRequest,
    KnowledgeMetadataEnvelope,
    KnowledgeMetadataResponse,
    NoteEnvelope,
    NoteListEnvelope,
    NoteSearchQuery,
    PresetTagEnvelope,
    PresetTagListEnvelope,
    SearchResultListEnvelope,
    TagListEnvelope,
    UpdateNoteRequest,
    UpdatePresetTagRequest,
)
from app.services.knowledge import (
    create_note_record,
    create_preset_tag_record,
    delete_note_record,
    delete_preset_tag_record,
    get_all_tags,
    get_knowledge_overview,
    get_note_detail,
    get_note_list,
    get_preset_tag_detail,
    get_preset_tag_list,
    search_note_records,
    update_note_record,
    update_preset_tag_record,
)

router = APIRouter(prefix="/knowledge")


def parse_search_query(request: Request) -> NoteSearchQuery:
    return NoteSearchQuery.model_validate(
        {
            "query": get_query_param(request, "query", ""),
            "tags": get_scalar_or_csv_list_query_param(request, "tags"),
            "limit": get_query_param(request, "limit", 20),
            "offset": get_query_param(request, "offset", 0),
        }
    )


@router.get("/notes", response_model=NoteListEnvelope)
async def list_notes(session: DbSession, user: AuthenticatedUser) -> NoteListEnvelope:
    items = await get_note_list(session, user.user_id)
    return NoteListEnvelope(items=items, total=len(items), source="postgres")


@router.post("/notes", response_model=NoteEnvelope, status_code=status.HTTP_201_CREATED)
async def create_note(
    payload: CreateNoteRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> NoteEnvelope:
    note = await create_note_record(session, user.user_id, payload)
    return NoteEnvelope(data=note, source="postgres")


@router.get("/notes/{note_id}", response_model=NoteEnvelope)
async def get_note(
    note_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> NoteEnvelope:
    note = await get_note_detail(session, user.user_id, str(note_id))
    if not note:
        raise http_not_found("Note not found")
    return NoteEnvelope(data=note, source="postgres")


@router.patch("/notes/{note_id}", response_model=NoteEnvelope)
async def update_note(
    note_id: UUID,
    payload: UpdateNoteRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> NoteEnvelope:
    note = await update_note_record(session, user.user_id, str(note_id), payload)
    if not note:
        raise http_not_found("Note not found")
    return NoteEnvelope(data=note, source="postgres")


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    note_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> Response:
    deleted = await delete_note_record(session, user.user_id, str(note_id))
    if not deleted:
        raise http_not_found("Note not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/search", response_model=SearchResultListEnvelope)
async def search_notes(
    session: DbSession,
    user: AuthenticatedUser,
    query: NoteSearchQuery = Depends(parse_search_query),
) -> SearchResultListEnvelope:
    items = await search_note_records(session, user.user_id, query)
    return SearchResultListEnvelope(items=items, total=len(items), source="postgres")


@router.get("/tags", response_model=TagListEnvelope)
async def list_tags(session: DbSession, user: AuthenticatedUser) -> TagListEnvelope:
    tags = await get_all_tags(session, user.user_id)
    return TagListEnvelope(items=tags, total=len(tags), source="postgres")


@router.get("/tags/preset", response_model=PresetTagListEnvelope)
async def list_preset_tags(session: DbSession, user: AuthenticatedUser) -> PresetTagListEnvelope:
    items = await get_preset_tag_list(session, user.user_id)
    return PresetTagListEnvelope(items=items, total=len(items), source="postgres")


@router.post("/tags/preset", response_model=PresetTagEnvelope, status_code=status.HTTP_201_CREATED)
async def create_preset_tag(
    payload: CreatePresetTagRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> PresetTagEnvelope:
    tag = await create_preset_tag_record(session, user.user_id, payload)
    return PresetTagEnvelope(data=tag, source="postgres")


@router.get("/tags/preset/{tag_id}", response_model=PresetTagEnvelope)
async def get_preset_tag(
    tag_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> PresetTagEnvelope:
    tag = await get_preset_tag_detail(session, user.user_id, str(tag_id))
    if not tag:
        raise http_not_found("Preset tag not found")
    return PresetTagEnvelope(data=tag, source="postgres")


@router.patch("/tags/preset/{tag_id}", response_model=PresetTagEnvelope)
async def update_preset_tag(
    tag_id: UUID,
    payload: UpdatePresetTagRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> PresetTagEnvelope:
    tag = await update_preset_tag_record(session, user.user_id, str(tag_id), payload)
    if not tag:
        raise http_not_found("Preset tag not found")
    return PresetTagEnvelope(data=tag, source="postgres")


@router.delete("/tags/preset/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preset_tag(
    tag_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> Response:
    deleted = await delete_preset_tag_record(session, user.user_id, str(tag_id))
    if not deleted:
        raise http_not_found("Preset tag not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/metadata", response_model=KnowledgeMetadataEnvelope)
async def get_metadata(session: DbSession, user: AuthenticatedUser) -> KnowledgeMetadataEnvelope:
    data = await get_knowledge_overview(session, user.user_id)
    return KnowledgeMetadataEnvelope(data=KnowledgeMetadataResponse(**data), source="postgres")
