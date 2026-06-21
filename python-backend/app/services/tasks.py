from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import VersionConflictError
from app.db.models import Task
from app.repositories.tasks import (
    create_task,
    delete_task,
    find_task_by_id,
    list_tasks,
    update_task,
)
from app.schemas.task import CreateTaskRequest, TaskResponse, UpdateTaskRequest


def to_task_response(task: Task) -> TaskResponse:
    return TaskResponse(
        id=str(task.id),
        title=task.title,
        completed=task.completed,
        priority=task.priority,
        dueDate=task.due_date.isoformat() if task.due_date else None,
        notes=task.notes,
        createdAt=int(task.created_at.timestamp() * 1000),
        updatedAt=int(task.updated_at.timestamp() * 1000),
        version=task.version,
    )


async def get_task_list(session: AsyncSession, user_id: str) -> list[TaskResponse]:
    return [to_task_response(task) for task in await list_tasks(session, user_id)]


async def create_task_record(
    session: AsyncSession, user_id: str, payload: CreateTaskRequest
) -> TaskResponse:
    task = await create_task(session, user_id, payload.model_dump(exclude_none=True))
    return to_task_response(task)


async def get_task_detail(session: AsyncSession, user_id: str, task_id: str) -> TaskResponse | None:
    task = await find_task_by_id(session, user_id, task_id)
    return to_task_response(task) if task else None


async def update_task_record(
    session: AsyncSession,
    user_id: str,
    task_id: str,
    payload: UpdateTaskRequest,
) -> TaskResponse | None:
    existing = await find_task_by_id(session, user_id, task_id)
    if not existing:
        return None

    task = await update_task(
        session,
        user_id,
        task_id,
        payload.version,
        payload.model_dump(exclude_unset=True, exclude={"version"}),
    )
    if not task:
        raise VersionConflictError(
            "Task was modified by another request. Please refresh and try again."
        )
    return to_task_response(task)


async def delete_task_record(
    session: AsyncSession,
    user_id: str,
    task_id: str,
) -> TaskResponse | None:
    task = await delete_task(session, user_id, task_id)
    return to_task_response(task) if task else None
