from uuid import UUID

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
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

router = APIRouter()


def parse_search_query(request: Request) -> NoteSearchQuery:
    raw_tags = request.query_params.getlist("tags")
    if len(raw_tags) == 1 and "," in raw_tags[0]:
        tags: str | list[str] | None = [item.strip() for item in raw_tags[0].split(",") if item.strip()]
    elif len(raw_tags) == 1:
        tags = raw_tags[0]
    elif len(raw_tags) > 1:
        tags = raw_tags
    else:
        tags = None

    return NoteSearchQuery.model_validate(
        {
            "query": request.query_params.get("query", ""),
            "tags": tags,
            "limit": request.query_params.get("limit", 20),
            "offset": request.query_params.get("offset", 0),
        }
    )


@router.get("/knowledge/notes", response_model=NoteListEnvelope)
async def list_notes(session: DbSession, user: AuthenticatedUser) -> NoteListEnvelope:
    items = await get_note_list(session, user.user_id)
    return NoteListEnvelope(items=items, total=len(items), source="postgres")


@router.post("/knowledge/notes", response_model=NoteEnvelope, status_code=status.HTTP_201_CREATED)
async def create_note(
    payload: CreateNoteRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> NoteEnvelope:
    note = await create_note_record(session, user.user_id, payload)
    return NoteEnvelope(data=note, source="postgres")


@router.get("/knowledge/notes/{note_id}", response_model=NoteEnvelope)
async def get_note(
    note_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> NoteEnvelope:
    note = await get_note_detail(session, user.user_id, str(note_id))
    if not note:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Note not found"})
    return NoteEnvelope(data=note, source="postgres")


@router.patch("/knowledge/notes/{note_id}", response_model=NoteEnvelope)
async def update_note(
    note_id: UUID,
    payload: UpdateNoteRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> NoteEnvelope:
    note = await update_note_record(session, user.user_id, str(note_id), payload)
    if not note:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Note not found"})
    return NoteEnvelope(data=note, source="postgres")


@router.delete("/knowledge/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    note_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> Response:
    deleted = await delete_note_record(session, user.user_id, str(note_id))
    if not deleted:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Note not found"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/knowledge/search", response_model=SearchResultListEnvelope)
async def search_notes(
    query: NoteSearchQuery = Depends(parse_search_query),
    session: DbSession = None,  # type: ignore[assignment]
    user: AuthenticatedUser = None,  # type: ignore[assignment]
) -> SearchResultListEnvelope:
    items = await search_note_records(session, user.user_id, query)
    return SearchResultListEnvelope(items=items, total=len(items), source="postgres")


@router.get("/knowledge/tags", response_model=TagListEnvelope)
async def list_tags(session: DbSession, user: AuthenticatedUser) -> TagListEnvelope:
    tags = await get_all_tags(session, user.user_id)
    return TagListEnvelope(items=tags, total=len(tags), source="postgres")


@router.get("/knowledge/tags/preset", response_model=PresetTagListEnvelope)
async def list_preset_tags(session: DbSession, user: AuthenticatedUser) -> PresetTagListEnvelope:
    items = await get_preset_tag_list(session, user.user_id)
    return PresetTagListEnvelope(items=items, total=len(items), source="postgres")


@router.post("/knowledge/tags/preset", response_model=PresetTagEnvelope, status_code=status.HTTP_201_CREATED)
async def create_preset_tag(
    payload: CreatePresetTagRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> PresetTagEnvelope:
    tag = await create_preset_tag_record(session, user.user_id, payload)
    return PresetTagEnvelope(data=tag, source="postgres")


@router.get("/knowledge/tags/preset/{tag_id}", response_model=PresetTagEnvelope)
async def get_preset_tag(
    tag_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> PresetTagEnvelope:
    tag = await get_preset_tag_detail(session, user.user_id, str(tag_id))
    if not tag:
        raise HTTPException(
            status_code=404,
            detail={"error": "NOT_FOUND", "message": "Preset tag not found"},
        )
    return PresetTagEnvelope(data=tag, source="postgres")


@router.patch("/knowledge/tags/preset/{tag_id}", response_model=PresetTagEnvelope)
async def update_preset_tag(
    tag_id: UUID,
    payload: UpdatePresetTagRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> PresetTagEnvelope:
    tag = await update_preset_tag_record(session, user.user_id, str(tag_id), payload)
    if not tag:
        raise HTTPException(
            status_code=404,
            detail={"error": "NOT_FOUND", "message": "Preset tag not found"},
        )
    return PresetTagEnvelope(data=tag, source="postgres")


@router.delete("/knowledge/tags/preset/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preset_tag(
    tag_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> Response:
    deleted = await delete_preset_tag_record(session, user.user_id, str(tag_id))
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail={"error": "NOT_FOUND", "message": "Preset tag not found"},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/knowledge/metadata", response_model=KnowledgeMetadataEnvelope)
async def get_metadata(session: DbSession, user: AuthenticatedUser) -> KnowledgeMetadataEnvelope:
    data = await get_knowledge_overview(session, user.user_id)
    return KnowledgeMetadataEnvelope(data=KnowledgeMetadataResponse(**data), source="postgres")
