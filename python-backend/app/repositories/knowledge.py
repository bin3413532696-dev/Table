from collections.abc import Sequence
from uuid import UUID

from app.db.models import KnowledgeNote, KnowledgePresetTag
from sqlalchemy import Select, delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession


def normalize_tags(value: Sequence[str] | None) -> list[str]:
    if not value:
        return []
    return [item for item in (tag.strip() for tag in value) if item]


def sanitize_tsquery(raw_query: str) -> str:
    words = []
    for word in raw_query.split():
        cleaned = "".join(ch for ch in word if ch not in '&|!():\'"\\')
        if cleaned:
            words.append(cleaned)
    return " & ".join(words)


def escape_like_pattern(raw_query: str) -> str:
    return raw_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def list_notes(session: AsyncSession, user_id: str) -> list[KnowledgeNote]:
    result = await session.scalars(
        select(KnowledgeNote)
        .where(KnowledgeNote.user_id == UUID(user_id))
        .order_by(KnowledgeNote.updated_at.desc())
    )
    return list(result)


async def create_note(session: AsyncSession, user_id: str, payload: dict) -> KnowledgeNote:
    note = KnowledgeNote(
        user_id=UUID(user_id),
        title=payload["title"],
        content=payload.get("content", ""),
        tags_json=normalize_tags(payload.get("tags")),
    )
    session.add(note)
    await session.commit()
    await session.refresh(note)
    return note


async def find_note_by_id(session: AsyncSession, user_id: str, note_id: str) -> KnowledgeNote | None:
    return await session.scalar(
        select(KnowledgeNote).where(
            KnowledgeNote.id == UUID(note_id),
            KnowledgeNote.user_id == UUID(user_id),
        )
    )


async def update_note(session: AsyncSession, user_id: str, note_id: str, payload: dict) -> KnowledgeNote | None:
    values = {"updated_at": func.now()}
    if "title" in payload:
        values["title"] = payload["title"]
    if "content" in payload:
        values["content"] = payload["content"]
    if "tags" in payload:
        values["tags_json"] = normalize_tags(payload["tags"])

    result = await session.execute(
        update(KnowledgeNote)
        .where(KnowledgeNote.id == UUID(note_id), KnowledgeNote.user_id == UUID(user_id))
        .values(**values)
        .returning(KnowledgeNote)
    )
    note = result.scalar_one_or_none()
    if note:
        await session.commit()
    else:
        await session.rollback()
    return note


async def delete_note(session: AsyncSession, user_id: str, note_id: str) -> bool:
    result = await session.execute(
        delete(KnowledgeNote).where(
            KnowledgeNote.id == UUID(note_id),
            KnowledgeNote.user_id == UUID(user_id),
        )
    )
    if result.rowcount and result.rowcount > 0:
        await session.commit()
        return True
    await session.rollback()
    return False


async def search_notes(
    session: AsyncSession,
    user_id: str,
    *,
    query: str,
    tags: list[str],
    limit: int,
    offset: int,
) -> list[dict]:
    params: dict[str, object] = {
        "user_id": user_id,
        "limit": limit,
        "offset": offset,
    }

    has_query = bool(query.strip())
    has_tags = bool(tags)
    escaped_query = f"%{escape_like_pattern(query)}%" if has_query else ""
    tsquery = sanitize_tsquery(query) if has_query else ""

    sql_parts = [
        """
        select
          n.id,
          n.title,
          n.content,
          n.tags_json as tags,
        """
    ]
    if has_query:
        sql_parts.append(
            """
          case
            when to_tsvector('simple', n.title) @@ to_tsquery('simple', :tsquery) then 2.0
            when to_tsvector('simple', n.content) @@ to_tsquery('simple', :tsquery) then 1.0
            when n.title ilike :escaped_query escape '\' then 0.8
            when n.content ilike :escaped_query escape '\' then 0.4
            else 0
          end as score,
            """
        )
        params["tsquery"] = tsquery
        params["escaped_query"] = escaped_query
    else:
        sql_parts.append("0::double precision as score,")

    sql_parts.append(
        """
          extract(epoch from n.updated_at) * 1000 as updated_at
        from knowledge_notes n
        where n.user_id = cast(:user_id as uuid)
        """
    )

    if has_tags:
        params["tags"] = tags
        sql_parts.append(
            """
            and exists (
              select 1
              from jsonb_array_elements_text(
                case
                  when jsonb_typeof(n.tags_json) = 'array' then n.tags_json
                  else '[]'::jsonb
                end
              ) as tag(value)
              where tag.value = any(cast(:tags as text[]))
            )
            """
        )

    if has_query:
        sql_parts.append(
            """
            and (
              to_tsvector('simple', n.title) @@ to_tsquery('simple', :tsquery)
              or to_tsvector('simple', n.content) @@ to_tsquery('simple', :tsquery)
              or n.title ilike :escaped_query escape '\'
              or n.content ilike :escaped_query escape '\'
            )
            """
        )

    sql_parts.append(
        """
        order by score desc, n.updated_at desc
        limit :limit
        offset :offset
        """
    )

    rows = (await session.execute(text(" ".join(sql_parts)), params)).mappings().all()
    return [
        {
            "id": str(row["id"]),
            "title": row["title"],
            "content": row["content"],
            "tags": [tag for tag in row["tags"] if isinstance(tag, str)] if isinstance(row["tags"], list) else [],
            "score": float(row["score"] or 0),
            "updatedAt": int(float(row["updated_at"] or 0)),
        }
        for row in rows
    ]


async def list_all_tags(session: AsyncSession, user_id: str) -> list[str]:
    rows = (
        await session.execute(
            text(
                """
                select distinct tag.value as tag
                from knowledge_notes n
                cross join jsonb_array_elements_text(
                  case
                    when jsonb_typeof(n.tags_json) = 'array' then n.tags_json
                    else '[]'::jsonb
                  end
                ) as tag(value)
                where n.user_id = cast(:user_id as uuid)
                order by tag.value asc
                """
            ),
            {"user_id": user_id},
        )
    ).mappings().all()
    return [row["tag"] for row in rows if isinstance(row["tag"], str)]


async def list_preset_tags(session: AsyncSession, user_id: str) -> list[KnowledgePresetTag]:
    result = await session.scalars(
        select(KnowledgePresetTag)
        .where(KnowledgePresetTag.user_id == UUID(user_id))
        .order_by(KnowledgePresetTag.sort_order.asc())
    )
    return list(result)


async def create_preset_tag(session: AsyncSession, user_id: str, payload: dict) -> KnowledgePresetTag:
    max_sort = await session.scalar(
        select(func.max(KnowledgePresetTag.sort_order)).where(KnowledgePresetTag.user_id == UUID(user_id))
    )
    tag = KnowledgePresetTag(
        user_id=UUID(user_id),
        name=payload["name"],
        color=payload.get("color", "#6B7280"),
        sort_order=(max_sort or -1) + 1,
    )
    session.add(tag)
    await session.commit()
    await session.refresh(tag)
    return tag


async def find_preset_tag_by_id(
    session: AsyncSession,
    user_id: str,
    tag_id: str,
) -> KnowledgePresetTag | None:
    return await session.scalar(
        select(KnowledgePresetTag).where(
            KnowledgePresetTag.id == UUID(tag_id),
            KnowledgePresetTag.user_id == UUID(user_id),
        )
    )


async def update_preset_tag(
    session: AsyncSession,
    user_id: str,
    tag_id: str,
    payload: dict,
) -> KnowledgePresetTag | None:
    values = {"updated_at": func.now()}
    if "name" in payload:
        values["name"] = payload["name"]
    if "color" in payload:
        values["color"] = payload["color"]
    if "sortOrder" in payload:
        values["sort_order"] = payload["sortOrder"]

    result = await session.execute(
        update(KnowledgePresetTag)
        .where(KnowledgePresetTag.id == UUID(tag_id), KnowledgePresetTag.user_id == UUID(user_id))
        .values(**values)
        .returning(KnowledgePresetTag)
    )
    tag = result.scalar_one_or_none()
    if tag:
        await session.commit()
    else:
        await session.rollback()
    return tag


async def delete_preset_tag(session: AsyncSession, user_id: str, tag_id: str) -> bool:
    result = await session.execute(
        delete(KnowledgePresetTag).where(
            KnowledgePresetTag.id == UUID(tag_id),
            KnowledgePresetTag.user_id == UUID(user_id),
        )
    )
    if result.rowcount and result.rowcount > 0:
        await session.commit()
        return True
    await session.rollback()
    return False


async def get_knowledge_metadata(session: AsyncSession, user_id: str) -> dict[str, int]:
    note_count = await session.scalar(
        select(func.count()).select_from(KnowledgeNote).where(KnowledgeNote.user_id == UUID(user_id))
    )
    preset_tag_count = await session.scalar(
        select(func.count()).select_from(KnowledgePresetTag).where(KnowledgePresetTag.user_id == UUID(user_id))
    )
    return {
        "noteCount": int(note_count or 0),
        "presetTagCount": int(preset_tag_count or 0),
    }
