from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AgentRun
from app.repositories.agent import find_agent_run_by_id
from app.schemas.agent import AgentRunDetailDto, AgentRunToolExecutionDto
from app.services.agent._graph import AgentConfirmationGraphDependencies, run_agent_confirmation_graph
from app.services.agent._memory_side_effects import schedule_memory_refresh_for_detail
from app.services.agent._run_hooks import fire_run_end_event
from app.services.agent._runtime_support import (
    _stream_provider_chat_completion,
    resolve_runtime_config_for_user,
)
from app.services.agent._runtime_support import (
    find_agent_run_by_id as runtime_find_agent_run_by_id,
)
from app.services.agent._state import (
    _bind_detail_to_run,
    _build_confirmed_run_detail,
    _build_continuation_provider_messages,
    _build_failed_confirmation_run_detail,
    _build_rejected_confirmation_run_detail,
    _find_pending_confirmation_tool,
    _persist_run_detail_state,
    _to_agent_run_detail,
    _validate_confirmation_request,
)
from app.services.agent._stream_events import (
    build_metadata_event,
    build_run_completed_event,
    drain_background_events,
    emit_noop_event,
)
from app.services.agent._tools import _execute_pending_confirmation_tool
from app.services.agent.registry import get_agent_hook_manager


async def _load_confirmable_run(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    tool_execution_id: str,
) -> tuple[AgentRun, AgentRunDetailDto, AgentRunToolExecutionDto] | None:
    run = await find_agent_run_by_id(session, user_id, run_id)
    if not run:
        return None
    if not _validate_confirmation_request(run, tool_execution_id):
        return None
    current_detail = _to_agent_run_detail(run)
    pending_tool = _find_pending_confirmation_tool(current_detail, tool_execution_id)
    if not pending_tool:
        return None
    return run, current_detail, pending_tool


async def _finalize_confirmation_detail(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    run: AgentRun,
    detail: AgentRunDetailDto,
) -> AgentRunDetailDto:
    persisted_run = await _persist_run_detail_state(session, user_id, run_id, detail)
    final_run = persisted_run or await runtime_find_agent_run_by_id(session, user_id, run_id) or run
    return _bind_detail_to_run(detail, final_run)


async def _execute_confirmation_graph(
    session: AsyncSession,
    user_id: str,
    run: AgentRun,
    current_detail: AgentRunDetailDto,
    pending_tool: AgentRunToolExecutionDto,
    *,
    emit_event,
) -> tuple[AgentRunDetailDto, str | None]:
    hooks = get_agent_hook_manager()

    def build_confirmed_run_detail(
        current_run,
        detail,
        confirmation_tool,
        assistant_text,
        chunks,
        executed_tool,
    ):
        return _build_confirmed_run_detail(
            current_run,
            detail,
            confirmation_tool,
            assistant_text,
            chunks,
            executed_tool=executed_tool,
        )

    def build_failed_confirmation_run_detail(
        current_run,
        detail,
        confirmation_tool,
        assistant_text,
        chunks,
        error_message,
        executed_tool,
        include_llm_events,
    ):
        return _build_failed_confirmation_run_detail(
            current_run,
            detail,
            confirmation_tool,
            assistant_text,
            chunks,
            error_message,
            executed_tool=executed_tool,
            include_llm_events=include_llm_events,
        )

    deps = AgentConfirmationGraphDependencies(
        resolve_runtime=resolve_runtime_config_for_user,
        stream_completion=lambda runtime_config, messages: _stream_provider_chat_completion(
            runtime_config,
            messages=messages,
        ),
        execute_pending_confirmation_tool=lambda current_session, current_user_id, confirmation_tool: (
            _execute_pending_confirmation_tool(current_session, current_user_id, confirmation_tool)
        ),
        build_continuation_provider_messages=_build_continuation_provider_messages,
        build_confirmed_run_detail=build_confirmed_run_detail,
        build_failed_confirmation_run_detail=build_failed_confirmation_run_detail,
    )
    graph_state = await run_agent_confirmation_graph(
        deps=deps,
        session=session,
        user_id=user_id,
        run=run,
        hooks=hooks,
        current_detail=current_detail,
        pending_tool=pending_tool,
        emit_event=emit_event,
    )
    detail = graph_state["detail"]
    if detail is None:
        raise RuntimeError("Confirmation graph completed without a final run detail.")
    return detail, graph_state["raised_error_message"]


async def _build_rejected_confirmation_result(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    tool_execution_id: str,
) -> tuple[AgentRun, AgentRunDetailDto] | None:
    loaded = await _load_confirmable_run(session, user_id, run_id, tool_execution_id)
    if not loaded:
        return None
    run, _current_detail, _pending_tool = loaded
    detail = _build_rejected_confirmation_run_detail(run)
    final_detail = await _finalize_confirmation_detail(session, user_id, run_id, run, detail)
    return run, final_detail


async def _finalize_confirmation_result(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    run: AgentRun,
    detail: AgentRunDetailDto,
    *,
    hooks: Any,
) -> AgentRunDetailDto:
    final_detail = await _finalize_confirmation_detail(session, user_id, run_id, run, detail)
    await schedule_memory_refresh_for_detail(
        session,
        user_id,
        str(run.session_id),
        final_detail,
        allowed_statuses={"completed"},
    )
    await fire_run_end_event(
        hooks,
        run_id=run_id,
        session_id=str(run.session_id),
        user_id=user_id,
        detail=final_detail,
        confirmation=True,
    )
    return final_detail


async def confirm_agent_tool_record(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    tool_execution_id: str,
) -> AgentRunDetailDto | None:
    hooks = get_agent_hook_manager()
    loaded = await _load_confirmable_run(session, user_id, run_id, tool_execution_id)
    if not loaded:
        return None
    run, current_detail, pending_tool = loaded
    detail, raised_error_message = await _execute_confirmation_graph(
        session,
        user_id,
        run,
        current_detail,
        pending_tool,
        emit_event=emit_noop_event,
    )
    final_detail = await _finalize_confirmation_result(
        session,
        user_id,
        run_id,
        run,
        detail,
        hooks=hooks,
    )
    if raised_error_message:
        raise RuntimeError(raised_error_message)
    return final_detail


async def stream_confirm_agent_tool_record(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    tool_execution_id: str,
) -> AsyncIterator[dict[str, Any]]:
    hooks = get_agent_hook_manager()
    loaded = await _load_confirmable_run(session, user_id, run_id, tool_execution_id)
    if not loaded:
        raise LookupError("Agent run or tool execution not found.")
    run, current_detail, pending_tool = loaded

    yield build_metadata_event(
        run_id=str(run.id),
        session_id=str(run.session_id),
        model=run.model,
    )

    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def emit_graph_event(event: dict[str, Any]) -> None:
        await queue.put(event)

    graph_task = asyncio.create_task(
        _execute_confirmation_graph(
            session,
            user_id,
            run,
            current_detail,
            pending_tool,
            emit_event=emit_graph_event,
        )
    )

    async for event in drain_background_events(graph_task, queue):
        yield event

    detail, raised_error_message = await graph_task
    final_detail = await _finalize_confirmation_result(
        session,
        user_id,
        run_id,
        run,
        detail,
        hooks=hooks,
    )
    if raised_error_message:
        raise RuntimeError(raised_error_message)
    yield build_run_completed_event(final_detail)


async def reject_agent_tool_record(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    tool_execution_id: str,
) -> AgentRunDetailDto | None:
    hooks = get_agent_hook_manager()
    result = await _build_rejected_confirmation_result(session, user_id, run_id, tool_execution_id)
    if not result:
        return None
    run, final_detail = result
    await fire_run_end_event(
        hooks,
        run_id=run_id,
        session_id=str(run.session_id),
        user_id=user_id,
        detail=final_detail,
        confirmation=True,
    )
    return final_detail


async def stream_reject_agent_tool_record(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    tool_execution_id: str,
) -> AsyncIterator[dict[str, Any]]:
    hooks = get_agent_hook_manager()
    result = await _build_rejected_confirmation_result(session, user_id, run_id, tool_execution_id)
    if not result:
        raise LookupError("Agent run or tool execution not found.")
    run, final_detail = result

    yield build_metadata_event(
        run_id=str(run.id),
        session_id=str(run.session_id),
        model=run.model,
    )
    await fire_run_end_event(
        hooks,
        run_id=run_id,
        session_id=str(run.session_id),
        user_id=user_id,
        detail=final_detail,
        confirmation=True,
    )
    yield build_run_completed_event(final_detail)
