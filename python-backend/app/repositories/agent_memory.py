from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AgentMemoryBlock, AgentMemoryEvent, AgentMemoryRecord


def _now() -> datetime:
    return datetime.now(UTC)


async def create_memory_event(
    session: AsyncSession,
    user_id: str,
    *,
    session_id: str,
    run_id: str,
    event_type: str,
    payload: dict,
) -> AgentMemoryEvent:
    item = AgentMemoryEvent(
        user_id=UUID(user_id),
        session_id=UUID(session_id),
        run_id=UUID(run_id),
        event_type=event_type,
        payload_json=payload,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


async def list_pending_memory_events(
    session: AsyncSession,
    user_id: str,
    *,
    session_id: str | None = None,
    limit: int = 50,
) -> list[AgentMemoryEvent]:
    stmt = (
        select(AgentMemoryEvent)
        .where(
            AgentMemoryEvent.user_id == UUID(user_id),
            AgentMemoryEvent.status == "pending",
        )
        .order_by(AgentMemoryEvent.created_at.asc())
        .limit(limit)
    )
    if session_id:
        stmt = stmt.where(AgentMemoryEvent.session_id == UUID(session_id))
    return list(await session.scalars(stmt))


async def mark_memory_event_processed(
    session: AsyncSession,
    user_id: str,
    event_id: str,
    *,
    status: str,
) -> AgentMemoryEvent | None:
    result = await session.execute(
        update(AgentMemoryEvent)
        .where(
            AgentMemoryEvent.id == UUID(event_id),
            AgentMemoryEvent.user_id == UUID(user_id),
        )
        .values(status=status, processed_at=func.now())
        .returning(AgentMemoryEvent)
    )
    item = result.scalar_one_or_none()
    if item:
        await session.commit()
    else:
        await session.rollback()
    return item


async def upsert_memory_record(
    session: AsyncSession,
    user_id: str,
    *,
    scope_type: str,
    scope_id: str,
    memory_kind: str,
    memory_slot: str,
    title: str,
    content: str,
    summary: str,
    confidence: float,
    salience: float,
    source_run_id: str | None,
    source_document_id: str | None,
    evidence: dict,
) -> AgentMemoryRecord:
    existing = await session.scalar(
        select(AgentMemoryRecord).where(
            AgentMemoryRecord.user_id == UUID(user_id),
            AgentMemoryRecord.scope_type == scope_type,
            AgentMemoryRecord.scope_id == scope_id,
            AgentMemoryRecord.memory_kind == memory_kind,
            AgentMemoryRecord.memory_slot == memory_slot,
            AgentMemoryRecord.content == content,
            AgentMemoryRecord.is_deleted.is_(False),
        )
    )

    if existing:
        existing.title = title
        existing.content = content
        existing.summary = summary
        existing.confidence = Decimal(str(confidence))
        existing.salience = Decimal(str(salience))
        existing.source_run_id = UUID(source_run_id) if source_run_id else None
        existing.source_document_id = UUID(source_document_id) if source_document_id else None
        existing.evidence_json = evidence
        existing.updated_at = _now()
        await session.commit()
        await session.refresh(existing)
        return existing

    item = AgentMemoryRecord(
        user_id=UUID(user_id),
        scope_type=scope_type,
        scope_id=scope_id,
        memory_kind=memory_kind,
        memory_slot=memory_slot,
        title=title,
        content=content,
        summary=summary,
        confidence=Decimal(str(confidence)),
        salience=Decimal(str(salience)),
        source_run_id=UUID(source_run_id) if source_run_id else None,
        source_document_id=UUID(source_document_id) if source_document_id else None,
        evidence_json=evidence,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


async def list_memory_records_for_scope(
    session: AsyncSession,
    user_id: str,
    *,
    scope_type: str,
    scope_id: str,
) -> list[AgentMemoryRecord]:
    return list(
        await session.scalars(
            select(AgentMemoryRecord)
            .where(
                AgentMemoryRecord.user_id == UUID(user_id),
                AgentMemoryRecord.scope_type == scope_type,
                AgentMemoryRecord.scope_id == scope_id,
                AgentMemoryRecord.is_deleted.is_(False),
            )
            .order_by(AgentMemoryRecord.updated_at.desc(), AgentMemoryRecord.created_at.desc())
        )
    )


async def delete_memory_records_for_scope(
    session: AsyncSession,
    user_id: str,
    *,
    scope_type: str,
    scope_id: str,
) -> int:
    result = await session.execute(
        delete(AgentMemoryRecord).where(
            AgentMemoryRecord.user_id == UUID(user_id),
            AgentMemoryRecord.scope_type == scope_type,
            AgentMemoryRecord.scope_id == scope_id,
        )
    )
    await session.commit()
    return int(result.rowcount or 0)


async def delete_memory_blocks_for_scope(
    session: AsyncSession,
    user_id: str,
    *,
    scope_type: str,
    scope_id: str,
) -> int:
    result = await session.execute(
        delete(AgentMemoryBlock).where(
            AgentMemoryBlock.user_id == UUID(user_id),
            AgentMemoryBlock.scope_type == scope_type,
            AgentMemoryBlock.scope_id == scope_id,
        )
    )
    await session.commit()
    return int(result.rowcount or 0)


async def upsert_memory_block(
    session: AsyncSession,
    user_id: str,
    *,
    block_type: str,
    scope_type: str,
    scope_id: str,
    content: str,
) -> AgentMemoryBlock:
    existing = await session.scalar(
        select(AgentMemoryBlock).where(
            AgentMemoryBlock.user_id == UUID(user_id),
            AgentMemoryBlock.block_type == block_type,
            AgentMemoryBlock.scope_type == scope_type,
            AgentMemoryBlock.scope_id == scope_id,
        )
    )
    if existing:
        existing.content = content
        existing.version = int(existing.version or 1) + 1
        existing.updated_at = _now()
        await session.commit()
        await session.refresh(existing)
        return existing

    item = AgentMemoryBlock(
        user_id=UUID(user_id),
        block_type=block_type,
        scope_type=scope_type,
        scope_id=scope_id,
        content=content,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


async def get_memory_block(
    session: AsyncSession,
    user_id: str,
    *,
    block_type: str,
    scope_type: str,
    scope_id: str,
) -> AgentMemoryBlock | None:
    return await session.scalar(
        select(AgentMemoryBlock).where(
            AgentMemoryBlock.user_id == UUID(user_id),
            AgentMemoryBlock.block_type == block_type,
            AgentMemoryBlock.scope_type == scope_type,
            AgentMemoryBlock.scope_id == scope_id,
        )
    )
