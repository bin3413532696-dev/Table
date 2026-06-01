from datetime import date, datetime
from uuid import UUID

from app.db.models import Task
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession


def parse_due_date(value: str | None) -> date | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()


async def list_tasks(session: AsyncSession, user_id: str) -> list[Task]:
    result = await session.scalars(
        select(Task).where(Task.user_id == UUID(user_id)).order_by(Task.updated_at.desc())
    )
    return list(result)


async def create_task(session: AsyncSession, user_id: str, payload: dict) -> Task:
    task = Task(
        user_id=UUID(user_id),
        title=payload["title"],
        completed=payload.get("completed", False),
        priority=payload.get("priority", "medium"),
        due_date=parse_due_date(payload.get("dueDate")),
        notes=payload.get("notes"),
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


async def find_task_by_id(session: AsyncSession, user_id: str, task_id: str) -> Task | None:
    return await session.scalar(
        select(Task).where(Task.id == UUID(task_id), Task.user_id == UUID(user_id))
    )


async def update_task(
    session: AsyncSession,
    user_id: str,
    task_id: str,
    version: int,
    payload: dict,
) -> Task | None:
    values = {"updated_at": func.now(), "version": Task.version + 1}
    if "title" in payload:
        values["title"] = payload["title"]
    if "priority" in payload:
        values["priority"] = payload["priority"]
    if "completed" in payload:
        values["completed"] = payload["completed"]
    if "notes" in payload:
        values["notes"] = payload["notes"]
    if "dueDate" in payload:
        values["due_date"] = parse_due_date(payload["dueDate"])

    result = await session.execute(
        update(Task)
        .where(Task.id == UUID(task_id), Task.user_id == UUID(user_id), Task.version == version)
        .values(**values)
        .returning(Task)
    )
    task = result.scalar_one_or_none()
    if task:
        await session.commit()
    else:
        await session.rollback()
    return task


async def delete_task(session: AsyncSession, user_id: str, task_id: str) -> Task | None:
    task = await find_task_by_id(session, user_id, task_id)
    if not task:
        return None

    await session.execute(delete(Task).where(Task.id == UUID(task_id)))
    await session.commit()
    return task
