from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from app.db.models import FinanceRecord, KnowledgeNote, KnowledgePresetTag, Task
from app.schemas.maintenance import (
    BusinessSnapshotKnowledgeResponse,
    BusinessSnapshotResponse,
    ImportBusinessSnapshotRequest,
    ImportBusinessSnapshotResponse,
    ResetScope,
    ResetWorkspaceResponse,
)
from app.services.finance import to_finance_record_response
from app.services.knowledge import to_note_response, to_preset_tag_response
from app.services.tasks import to_task_response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_timestamp_date(value: object) -> datetime:
    if isinstance(value, (int, float)) and value > 0:
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    return _now()


def _to_optional_due_date(value: object) -> date | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return date.fromisoformat(value)


def _to_record_date(value: object) -> date:
    if isinstance(value, str) and value.strip():
        return date.fromisoformat(value)
    return _now().date()


def _normalize_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _normalize_imported_tasks(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = item.get("title")
        completed = item.get("completed")
        priority = item.get("priority")
        if not isinstance(title, str) or not title.strip():
            continue
        if not isinstance(completed, bool):
            continue
        if priority not in {"low", "medium", "high"}:
            continue
        normalized.append(item)
    return normalized


def _normalize_imported_finance(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        finance_type = item.get("type")
        amount = item.get("amount")
        description = item.get("description")
        category = item.get("category")
        record_date = item.get("date")
        if finance_type not in {"income", "expense"}:
            continue
        if not isinstance(amount, (int, float)) or amount < 0:
            continue
        if not isinstance(description, str) or not description.strip():
            continue
        if not isinstance(category, str) or not category.strip():
            continue
        if not isinstance(record_date, str) or not record_date.strip():
            continue
        normalized.append(item)
    return normalized


def _normalize_imported_notes(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = item.get("title")
        if not isinstance(title, str) or not title.strip():
            continue
        normalized.append(item)
    return normalized


def _normalize_imported_preset_tags(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        normalized.append(item)
    return normalized


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
        exportedAt=_now().isoformat(),
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
    tasks = _normalize_imported_tasks(payload.tasks)
    finance = _normalize_imported_finance(payload.finance)
    knowledge_notes = _normalize_imported_notes(payload.knowledge.notes if payload.knowledge else None)
    preset_tags = _normalize_imported_preset_tags(payload.knowledge.presetTags if payload.knowledge else None)

    if not tasks and not finance and not knowledge_notes and not preset_tags:
        raise ValueError("Cannot import empty snapshot")

    backup = await export_business_snapshot(session, user_id)

    await session.execute(delete(Task).where(Task.user_id == user_uuid))
    await session.execute(delete(FinanceRecord).where(FinanceRecord.user_id == user_uuid))
    await session.execute(delete(KnowledgeNote).where(KnowledgeNote.user_id == user_uuid))
    await session.execute(delete(KnowledgePresetTag).where(KnowledgePresetTag.user_id == user_uuid))

    created_at_base = _now()

    for index, item in enumerate(tasks):
        session.add(
            Task(
                id=uuid4(),
                user_id=user_uuid,
                title=str(item["title"]).strip(),
                completed=bool(item.get("completed", False)),
                priority=str(item.get("priority") or "medium"),
                due_date=_to_optional_due_date(item.get("dueDate")),
                notes=item.get("notes") if isinstance(item.get("notes"), str) else None,
                created_at=_to_timestamp_date(item.get("createdAt") or int((created_at_base.timestamp() * 1000) + index)),
                updated_at=_to_timestamp_date(item.get("updatedAt") or int((created_at_base.timestamp() * 1000) + index)),
            )
        )

    for index, item in enumerate(finance):
        session.add(
            FinanceRecord(
                id=uuid4(),
                user_id=user_uuid,
                type=str(item["type"]),
                amount=Decimal(str(item["amount"])),
                category=str(item["category"]).strip(),
                description=str(item["description"]).strip(),
                record_date=_to_record_date(item.get("date")),
                model=item.get("model") if isinstance(item.get("model"), str) and item.get("model").strip() else None,
                created_at=_to_timestamp_date(item.get("createdAt") or int((created_at_base.timestamp() * 1000) + index)),
                updated_at=_to_timestamp_date(item.get("updatedAt") or int((created_at_base.timestamp() * 1000) + index)),
            )
        )

    for index, item in enumerate(knowledge_notes):
        session.add(
            KnowledgeNote(
                id=uuid4(),
                user_id=user_uuid,
                title=str(item["title"]).strip(),
                content=item.get("content") if isinstance(item.get("content"), str) else "",
                tags_json=_normalize_string_list(item.get("tags")),
                created_at=_to_timestamp_date(item.get("createdAt") or int((created_at_base.timestamp() * 1000) + index)),
                updated_at=_to_timestamp_date(item.get("updatedAt") or int((created_at_base.timestamp() * 1000) + index)),
            )
        )

    for index, item in enumerate(preset_tags):
        session.add(
            KnowledgePresetTag(
                id=uuid4(),
                user_id=user_uuid,
                name=str(item["name"]).strip(),
                color=item.get("color") if isinstance(item.get("color"), str) and item.get("color").strip() else "#6B7280",
                sort_order=int(item.get("sortOrder")) if isinstance(item.get("sortOrder"), int) else index,
                created_at=_now(),
                updated_at=_now(),
            )
        )

    await session.commit()

    return ImportBusinessSnapshotResponse(
        success=True,
        importedAt=_now().isoformat(),
        backup=backup,
        tasks=len(tasks),
        finance=len(finance),
        notes=len(knowledge_notes),
        presetTags=len(preset_tags),
    )


async def reset_workspace_data(
    session: AsyncSession,
    user_id: str,
    scope: ResetScope = "all",
) -> ResetWorkspaceResponse:
    user_uuid = UUID(user_id)
    should_reset_tasks = scope in {"all", "tasks"}
    should_reset_finance = scope in {"all", "finance"}
    should_reset_knowledge = scope in {"all", "knowledge"}

    if should_reset_tasks:
        await session.execute(delete(Task).where(Task.user_id == user_uuid))
    if should_reset_finance:
        await session.execute(delete(FinanceRecord).where(FinanceRecord.user_id == user_uuid))
    if should_reset_knowledge:
        await session.execute(delete(KnowledgeNote).where(KnowledgeNote.user_id == user_uuid))
        await session.execute(delete(KnowledgePresetTag).where(KnowledgePresetTag.user_id == user_uuid))

    now = _now()

    if should_reset_tasks:
        session.add_all(
            [
                Task(
                    id=uuid4(),
                    user_id=user_uuid,
                    title="Review migration storage design",
                    completed=False,
                    priority="high",
                    due_date=date(2026, 5, 10),
                    notes="Clarify backend ownership and migration path.",
                    created_at=now,
                    updated_at=now,
                ),
                Task(
                    id=uuid4(),
                    user_id=user_uuid,
                    title="Land PostgreSQL write path",
                    completed=True,
                    priority="medium",
                    due_date=date(2026, 5, 3),
                    notes="Complete first-phase persistence baseline.",
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )

    if should_reset_finance:
        session.add_all(
            [
                FinanceRecord(
                    id=uuid4(),
                    user_id=user_uuid,
                    type="expense",
                    amount=Decimal("299.00"),
                    category="infrastructure",
                    description="PostgreSQL environment setup",
                    record_date=date(2026, 5, 4),
                    model="backend",
                    created_at=now,
                    updated_at=now,
                ),
                FinanceRecord(
                    id=uuid4(),
                    user_id=user_uuid,
                    type="income",
                    amount=Decimal("1200.00"),
                    category="project",
                    description="Milestone project settlement",
                    record_date=date(2026, 5, 1),
                    model="delivery",
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )

    if should_reset_knowledge:
        session.add(
            KnowledgeNote(
                id=uuid4(),
                user_id=user_uuid,
                title="System architecture note",
                content="Backend stack uses FastAPI, SQLAlchemy, and PostgreSQL.",
                tags_json=["architecture", "backend"],
                created_at=now,
                updated_at=now,
            )
        )
        session.add_all(
            [
                KnowledgePresetTag(
                    id=uuid4(),
                    user_id=user_uuid,
                    name="architecture",
                    color="#3B82F6",
                    sort_order=0,
                    created_at=now,
                    updated_at=now,
                ),
                KnowledgePresetTag(
                    id=uuid4(),
                    user_id=user_uuid,
                    name="backend",
                    color="#10B981",
                    sort_order=1,
                    created_at=now,
                    updated_at=now,
                ),
                KnowledgePresetTag(
                    id=uuid4(),
                    user_id=user_uuid,
                    name="frontend",
                    color="#F59E0B",
                    sort_order=2,
                    created_at=now,
                    updated_at=now,
                ),
                KnowledgePresetTag(
                    id=uuid4(),
                    user_id=user_uuid,
                    name="design",
                    color="#EF4444",
                    sort_order=3,
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )

    await session.commit()
    return ResetWorkspaceResponse(success=True, scope=scope, resetAt=_now().isoformat())
