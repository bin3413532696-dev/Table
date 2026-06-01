from app.dependencies import AuthenticatedUser, DbSession
from app.schemas.task import (
    CreateTaskRequest,
    TaskEnvelope,
    TaskListEnvelope,
    UpdateTaskRequest,
)
from app.services.tasks import (
    create_task_record,
    delete_task_record,
    get_task_detail,
    get_task_list,
    update_task_record,
)
from fastapi import APIRouter, HTTPException, Response, status
from uuid import UUID

router = APIRouter()


@router.get("/", response_model=TaskListEnvelope)
async def list_tasks(session: DbSession, user: AuthenticatedUser) -> TaskListEnvelope:
    items = await get_task_list(session, user.user_id)
    return TaskListEnvelope(items=items, total=len(items), source="postgres")


@router.post("/", response_model=TaskEnvelope, status_code=status.HTTP_201_CREATED)
async def create_task(
    payload: CreateTaskRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> TaskEnvelope:
    task = await create_task_record(session, user.user_id, payload)
    return TaskEnvelope(data=task, source="postgres")


@router.get("/{task_id}", response_model=TaskEnvelope)
async def get_task(task_id: UUID, session: DbSession, user: AuthenticatedUser) -> TaskEnvelope:
    task = await get_task_detail(session, user.user_id, str(task_id))
    if not task:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Task not found"})
    return TaskEnvelope(data=task, source="postgres")


@router.patch("/{task_id}", response_model=TaskEnvelope)
async def update_task(
    task_id: UUID,
    payload: UpdateTaskRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> TaskEnvelope:
    task = await update_task_record(session, user.user_id, str(task_id), payload)
    if not task:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Task not found"})
    return TaskEnvelope(data=task, source="postgres")


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: UUID, session: DbSession, user: AuthenticatedUser) -> Response:
    task = await delete_task_record(session, user.user_id, str(task_id))
    if not task:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Task not found"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
