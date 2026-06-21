from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import FinanceRecord, KnowledgeNote, KnowledgePresetTag, Task
from app.schemas.maintenance import ResetScope, ResetWorkspaceResponse
from app.services.maintenance_utils import now


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

    current_time = now()

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
                    created_at=current_time,
                    updated_at=current_time,
                ),
                Task(
                    id=uuid4(),
                    user_id=user_uuid,
                    title="Land PostgreSQL write path",
                    completed=True,
                    priority="medium",
                    due_date=date(2026, 5, 3),
                    notes="Complete first-phase persistence baseline.",
                    created_at=current_time,
                    updated_at=current_time,
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
                    created_at=current_time,
                    updated_at=current_time,
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
                    created_at=current_time,
                    updated_at=current_time,
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
                created_at=current_time,
                updated_at=current_time,
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
                    created_at=current_time,
                    updated_at=current_time,
                ),
                KnowledgePresetTag(
                    id=uuid4(),
                    user_id=user_uuid,
                    name="backend",
                    color="#10B981",
                    sort_order=1,
                    created_at=current_time,
                    updated_at=current_time,
                ),
                KnowledgePresetTag(
                    id=uuid4(),
                    user_id=user_uuid,
                    name="frontend",
                    color="#F59E0B",
                    sort_order=2,
                    created_at=current_time,
                    updated_at=current_time,
                ),
                KnowledgePresetTag(
                    id=uuid4(),
                    user_id=user_uuid,
                    name="design",
                    color="#EF4444",
                    sort_order=3,
                    created_at=current_time,
                    updated_at=current_time,
                ),
            ]
        )

    await session.commit()
    return ResetWorkspaceResponse(success=True, scope=scope, resetAt=now().isoformat())
