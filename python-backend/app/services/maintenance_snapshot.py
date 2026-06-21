from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import FinanceRecord, KnowledgeNote, KnowledgePresetTag, Task
from app.schemas.maintenance import (
    BusinessSnapshotKnowledgeResponse,
    BusinessSnapshotResponse,
    ImportBusinessSnapshotRequest,
    ImportBusinessSnapshotResponse,
)
from app.services.finance import to_finance_record_response
from app.services.knowledge import to_note_response, to_preset_tag_response
from app.services.maintenance_utils import (
    normalize_imported_finance,
    normalize_imported_notes,
    normalize_imported_preset_tags,
    normalize_imported_tasks,
    normalize_string_list,
    now,
    to_optional_due_date,
    to_record_date,
    to_timestamp_date,
)
from app.services.tasks import to_task_response


async def export_business_snapshot(session: AsyncSession, user_id: str) -> BusinessSnapshotResponse:
    user_uuid = UUID(user_id)
    tasks = list(
        await session.scalars(
            select(Task)
            .where(Task.user_id == user_uuid)
            .order_by(Task.updated_at.desc(), Task.created_at.desc())
        )
    )
    finance = list(
        await session.scalars(
            select(FinanceRecord)
            .where(FinanceRecord.user_id == user_uuid)
            .order_by(FinanceRecord.updated_at.desc(), FinanceRecord.created_at.desc())
        )
    )
    notes = list(
        await session.scalars(
            select(KnowledgeNote)
            .where(KnowledgeNote.user_id == user_uuid)
            .order_by(KnowledgeNote.updated_at.desc(), KnowledgeNote.created_at.desc())
        )
    )
    preset_tags = list(
        await session.scalars(
            select(KnowledgePresetTag)
            .where(KnowledgePresetTag.user_id == user_uuid)
            .order_by(KnowledgePresetTag.sort_order.asc(), KnowledgePresetTag.created_at.asc())
        )
    )

    return BusinessSnapshotResponse(
        version=1,
        exportedAt=now().isoformat(),
        tasks=[to_task_response(item) for item in tasks],
        finance=[to_finance_record_response(item) for item in finance],
        knowledge=BusinessSnapshotKnowledgeResponse(
            notes=[to_note_response(item) for item in notes],
            presetTags=[to_preset_tag_response(item) for item in preset_tags],
        ),
    )


async def import_business_snapshot(
    session: AsyncSession,
    user_id: str,
    payload: ImportBusinessSnapshotRequest,
) -> ImportBusinessSnapshotResponse:
    user_uuid = UUID(user_id)
    tasks = normalize_imported_tasks(payload.tasks)
    finance = normalize_imported_finance(payload.finance)
    knowledge_notes = normalize_imported_notes(payload.knowledge.notes if payload.knowledge else None)
    preset_tags = normalize_imported_preset_tags(payload.knowledge.presetTags if payload.knowledge else None)

    if not tasks and not finance and not knowledge_notes and not preset_tags:
        raise ValueError("Cannot import empty snapshot")

    backup = await export_business_snapshot(session, user_id)

    await session.execute(delete(Task).where(Task.user_id == user_uuid))
    await session.execute(delete(FinanceRecord).where(FinanceRecord.user_id == user_uuid))
    await session.execute(delete(KnowledgeNote).where(KnowledgeNote.user_id == user_uuid))
    await session.execute(delete(KnowledgePresetTag).where(KnowledgePresetTag.user_id == user_uuid))

    created_at_base = now()

    for index, item in enumerate(tasks):
        timestamp_ms = int((created_at_base.timestamp() * 1000) + index)
        session.add(
            Task(
                id=uuid4(),
                user_id=user_uuid,
                title=str(item["title"]).strip(),
                completed=bool(item.get("completed", False)),
                priority=str(item.get("priority") or "medium"),
                due_date=to_optional_due_date(item.get("dueDate")),
                notes=item.get("notes") if isinstance(item.get("notes"), str) else None,
                created_at=to_timestamp_date(item.get("createdAt") or timestamp_ms),
                updated_at=to_timestamp_date(item.get("updatedAt") or timestamp_ms),
            )
        )

    for index, item in enumerate(finance):
        timestamp_ms = int((created_at_base.timestamp() * 1000) + index)
        session.add(
            FinanceRecord(
                id=uuid4(),
                user_id=user_uuid,
                type=str(item["type"]),
                amount=Decimal(str(item["amount"])),
                category=str(item["category"]).strip(),
                description=str(item["description"]).strip(),
                record_date=to_record_date(item.get("date")),
                model=item.get("model") if isinstance(item.get("model"), str) and item.get("model").strip() else None,
                created_at=to_timestamp_date(item.get("createdAt") or timestamp_ms),
                updated_at=to_timestamp_date(item.get("updatedAt") or timestamp_ms),
            )
        )

    for index, item in enumerate(knowledge_notes):
        timestamp_ms = int((created_at_base.timestamp() * 1000) + index)
        session.add(
            KnowledgeNote(
                id=uuid4(),
                user_id=user_uuid,
                title=str(item["title"]).strip(),
                content=item.get("content") if isinstance(item.get("content"), str) else "",
                tags_json=normalize_string_list(item.get("tags")),
                created_at=to_timestamp_date(item.get("createdAt") or timestamp_ms),
                updated_at=to_timestamp_date(item.get("updatedAt") or timestamp_ms),
            )
        )

    for index, item in enumerate(preset_tags):
        session.add(
            KnowledgePresetTag(
                id=uuid4(),
                user_id=user_uuid,
                name=str(item["name"]).strip(),
                color=(
                    item.get("color")
                    if isinstance(item.get("color"), str) and item.get("color").strip()
                    else "#6B7280"
                ),
                sort_order=int(item.get("sortOrder")) if isinstance(item.get("sortOrder"), int) else index,
                created_at=now(),
                updated_at=now(),
            )
        )

    await session.commit()

    return ImportBusinessSnapshotResponse(
        success=True,
        importedAt=now().isoformat(),
        backup=backup,
        tasks=len(tasks),
        finance=len(finance),
        notes=len(knowledge_notes),
        presetTags=len(preset_tags),
    )
