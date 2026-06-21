from __future__ import annotations

from app.repositories.tasks import (
    create_task as create_task_repo,
)
from app.repositories.tasks import (
    delete_task as delete_task_repo,
)
from app.repositories.tasks import (
    find_task_by_id,
)
from app.repositories.tasks import (
    list_tasks as list_tasks_repo,
)
from app.repositories.tasks import (
    update_task as update_task_repo,
)
from app.schemas.task import CreateTaskRequest, UpdateTaskRequest
from app.services.agent._constants import _normalize_task_priority, _now
from app.services.agent.registry import AgentToolDefinition, AgentToolExecutionContext, register_tool_definition
from app.services.agent.tools.common import int_arg, string_arg
from app.services.tasks import to_task_response


async def _query_tasks(context: AgentToolExecutionContext, arguments: dict[str, object]) -> object:
    tasks = await list_tasks_repo(context.session, context.user_id)
    completed_filter = arguments.get("completed")
    priority_filter = _normalize_task_priority(arguments.get("priority"))
    limit = int_arg(arguments, "limit", 20)
    return [
        to_task_response(task).model_dump()
        for task in tasks
        if (completed_filter is None or task.completed == completed_filter)
        and (priority_filter is None or task.priority == priority_filter)
    ][:limit]


async def _get_task_stats(context: AgentToolExecutionContext, _arguments: dict[str, object]) -> object:
    tasks = await list_tasks_repo(context.session, context.user_id)
    completed_count = sum(1 for task in tasks if task.completed)
    today = _now().date()
    overdue_count = sum(
        1 for task in tasks if task.due_date is not None and not task.completed and task.due_date < today
    )
    return {
        "total": len(tasks),
        "completed": completed_count,
        "pending": len(tasks) - completed_count,
        "overdue": overdue_count,
    }


async def _unsupported_mutation(name: str) -> object:
    raise ValueError(f"{name} should only execute after user confirmation.")


async def _create_task_after_confirmation(
    context: AgentToolExecutionContext,
    arguments: dict[str, object],
) -> object:
    payload = CreateTaskRequest.model_validate(
        {
            "title": arguments.get("title"),
            "priority": _normalize_task_priority(arguments.get("priority")) or "medium",
            "dueDate": string_arg(arguments, "dueDate"),
            "notes": string_arg(arguments, "notes") or string_arg(arguments, "description"),
        }
    )
    task = await create_task_repo(context.session, context.user_id, payload.model_dump(exclude_none=True))
    return to_task_response(task).model_dump()


async def _update_task_after_confirmation(
    context: AgentToolExecutionContext,
    arguments: dict[str, object],
) -> object:
    task_id = string_arg(arguments, "id")
    if not task_id:
        raise ValueError("update_task requires a task id.")
    existing = await find_task_by_id(context.session, context.user_id, task_id)
    if not existing:
        raise ValueError(f"Task not found: {task_id}")

    payload = UpdateTaskRequest.model_validate(
        {
            "title": string_arg(arguments, "title"),
            "priority": _normalize_task_priority(arguments.get("priority")),
            "dueDate": string_arg(arguments, "dueDate"),
            "completed": arguments.get("completed"),
            "version": existing.version,
        }
    )
    updated = await update_task_repo(
        context.session,
        context.user_id,
        task_id,
        payload.version,
        payload.model_dump(exclude_unset=True, exclude={"version"}),
    )
    if not updated:
        raise RuntimeError("Task was modified by another request. Please refresh and try again.")
    return to_task_response(updated).model_dump()


async def _delete_task_after_confirmation(
    context: AgentToolExecutionContext,
    arguments: dict[str, object],
) -> object:
    task_id = string_arg(arguments, "id")
    if not task_id:
        raise ValueError("delete_task requires a task id.")
    deleted = await delete_task_repo(context.session, context.user_id, task_id)
    if not deleted:
        raise ValueError(f"Task not found: {task_id}")
    return {"id": task_id, "deleted": True}


def register_task_tools() -> None:
    definitions = [
        AgentToolDefinition(
            name="query_tasks",
            description="查询任务列表，可按完成状态、优先级和数量过滤。",
            prompt_signature="query_tasks(completed?, priority?, limit?)",
            category="query",
            module="tasks",
            execute=_query_tasks,
        ),
        AgentToolDefinition(
            name="get_task_stats",
            description="获取任务总数、完成数、待处理数与逾期数。",
            prompt_signature="get_task_stats()",
            category="query",
            module="tasks",
            execute=_get_task_stats,
        ),
        AgentToolDefinition(
            name="create_task",
            description="创建任务。",
            prompt_signature="create_task(title!, priority?, dueDate?, description?)",
            category="mutation",
            module="tasks",
            execute=lambda _context, _arguments: _unsupported_mutation("create_task"),
            execute_after_confirmation=_create_task_after_confirmation,
            requires_confirmation=True,
        ),
        AgentToolDefinition(
            name="update_task",
            description="更新任务。",
            prompt_signature="update_task(id!, title?, completed?, priority?, dueDate?)",
            category="mutation",
            module="tasks",
            execute=lambda _context, _arguments: _unsupported_mutation("update_task"),
            execute_after_confirmation=_update_task_after_confirmation,
            requires_confirmation=True,
        ),
        AgentToolDefinition(
            name="delete_task",
            description="删除任务。",
            prompt_signature="delete_task(id!)",
            category="mutation",
            module="tasks",
            execute=lambda _context, _arguments: _unsupported_mutation("delete_task"),
            execute_after_confirmation=_delete_task_after_confirmation,
            requires_confirmation=True,
        ),
    ]
    for definition in definitions:
        register_tool_definition(definition)
