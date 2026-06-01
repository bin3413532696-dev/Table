from app.db.models import KnowledgeNote, KnowledgePresetTag
from app.repositories.knowledge import (
    create_note,
    create_preset_tag,
    delete_note,
    delete_preset_tag,
    find_note_by_id,
    find_preset_tag_by_id,
    get_knowledge_metadata,
    list_all_tags,
    list_notes,
    list_preset_tags,
    normalize_tags,
    search_notes,
    update_note,
    update_preset_tag,
)
from app.schemas.knowledge import (
    CreateNoteRequest,
    CreatePresetTagRequest,
    NoteResponse,
    NoteSearchHitResponse,
    NoteSearchQuery,
    PresetTagResponse,
    UpdateNoteRequest,
    UpdatePresetTagRequest,
)
from sqlalchemy.ext.asyncio import AsyncSession


def to_note_response(note: KnowledgeNote) -> NoteResponse:
    return NoteResponse(
        id=str(note.id),
        title=note.title,
        content=note.content,
        tags=normalize_tags(note.tags_json),
        createdAt=int(note.created_at.timestamp() * 1000),
        updatedAt=int(note.updated_at.timestamp() * 1000),
    )


def to_preset_tag_response(tag: KnowledgePresetTag) -> PresetTagResponse:
    return PresetTagResponse(
        id=str(tag.id),
        name=tag.name,
        color=tag.color,
        sortOrder=tag.sort_order,
    )


async def get_note_list(session: AsyncSession, user_id: str) -> list[NoteResponse]:
    return [to_note_response(note) for note in await list_notes(session, user_id)]


async def create_note_record(session: AsyncSession, user_id: str, payload: CreateNoteRequest) -> NoteResponse:
    note = await create_note(session, user_id, payload.model_dump())
    return to_note_response(note)


async def get_note_detail(session: AsyncSession, user_id: str, note_id: str) -> NoteResponse | None:
    note = await find_note_by_id(session, user_id, note_id)
    return to_note_response(note) if note else None


async def update_note_record(
    session: AsyncSession,
    user_id: str,
    note_id: str,
    payload: UpdateNoteRequest,
) -> NoteResponse | None:
    note = await update_note(session, user_id, note_id, payload.model_dump(exclude_unset=True))
    return to_note_response(note) if note else None


async def delete_note_record(session: AsyncSession, user_id: str, note_id: str) -> bool:
    return await delete_note(session, user_id, note_id)


async def search_note_records(
    session: AsyncSession,
    user_id: str,
    payload: NoteSearchQuery,
) -> list[NoteSearchHitResponse]:
    normalized_tags = (
        normalize_tags([payload.tags]) if isinstance(payload.tags, str) else normalize_tags(payload.tags)
    )
    rows = await search_notes(
        session,
        user_id,
        query=payload.query,
        tags=normalized_tags,
        limit=payload.limit,
        offset=payload.offset,
    )
    return [NoteSearchHitResponse(**row) for row in rows]


async def get_all_tags(session: AsyncSession, user_id: str) -> list[str]:
    return await list_all_tags(session, user_id)


async def get_preset_tag_list(session: AsyncSession, user_id: str) -> list[PresetTagResponse]:
    return [to_preset_tag_response(tag) for tag in await list_preset_tags(session, user_id)]


async def create_preset_tag_record(
    session: AsyncSession,
    user_id: str,
    payload: CreatePresetTagRequest,
) -> PresetTagResponse:
    tag = await create_preset_tag(session, user_id, payload.model_dump())
    return to_preset_tag_response(tag)


async def get_preset_tag_detail(
    session: AsyncSession,
    user_id: str,
    tag_id: str,
) -> PresetTagResponse | None:
    tag = await find_preset_tag_by_id(session, user_id, tag_id)
    return to_preset_tag_response(tag) if tag else None


async def update_preset_tag_record(
    session: AsyncSession,
    user_id: str,
    tag_id: str,
    payload: UpdatePresetTagRequest,
) -> PresetTagResponse | None:
    tag = await update_preset_tag(session, user_id, tag_id, payload.model_dump(exclude_unset=True))
    return to_preset_tag_response(tag) if tag else None


async def delete_preset_tag_record(session: AsyncSession, user_id: str, tag_id: str) -> bool:
    return await delete_preset_tag(session, user_id, tag_id)


async def get_knowledge_overview(session: AsyncSession, user_id: str) -> dict[str, int]:
    return await get_knowledge_metadata(session, user_id)
