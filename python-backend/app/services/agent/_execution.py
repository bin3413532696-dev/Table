from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AgentRun
from app.repositories.agent import create_agent_run, find_agent_run_by_id, find_user_setting, update_agent_session
from app.schemas.agent import (
    AgentRunMessageDto,
    AgentRunToolExecutionDto,
    CreateAgentRunRequest,
    TimelineEvent,
)
from app.services.agent._constants import AgentToolCall, _iso_timestamp, _now, _timestamp_ms
from app.services.agent._graph import AgentExecutionGraphDependencies, run_agent_execution_graph
from app.services.agent._long_term_memory import append_agent_memory_event, build_long_term_memory_context
from app.services.agent._memory import _build_session_memory_block
from app.services.agent._memory_side_effects import schedule_memory_refresh_for_detail
from app.services.agent._run_hooks import fire_run_end_event
from app.services.agent._runs import resolve_run_session
from app.services.agent._runtime_support import (
    _stream_provider_chat_completion,
    resolve_runtime_config_for_user,
)
from app.services.agent._state import (
    _bind_detail_to_run,
    _build_agent_run_detail,
    _build_initial_run_messages,
    _build_pending_tool_call,
    _build_provider_messages,
    _extract_system_prompt,
    _persist_run_detail_state,
)
from app.services.agent._stream_events import build_metadata_event, build_run_completed_event, drain_background_events
from app.services.agent._tools import (
    _append_tool_message,
    _build_effective_system_prompt,
    _build_tool_result_prompt,
    _execute_agent_tool_call,
    _parse_tool_calls,
    _tool_requires_confirmation,
)
from app.services.agent.registry import get_agent_hook_manager


async def _preexecute_rag_lookup(
    session: AsyncSession,
    user_id: str,
    run: AgentRun,
    hooks: Any,
    payload: CreateAgentRunRequest,
    *,
    run_messages: list[AgentRunMessageDto],
    provider_messages: list[dict[str, str]],
) -> tuple[
    list[AgentRunToolExecutionDto],
    list[AgentRunMessageDto],
    list[dict[str, str]],
    list[TimelineEvent],
]:
    if not payload.ragEnabled:
        return [], run_messages, provider_messages, []
    tool_call = AgentToolCall(
        id=f"forced-rag-{run.id}",
        name="rag_answer",
        arguments={
            "question": payload.inputText,
            "limit": 8,
        },
    )
    tool_started_at = _iso_timestamp()
    await hooks.fire(
        "before_tool",
        run_id=str(run.id),
        session_id=str(run.session_id),
        user_id=user_id,
        tool_name=tool_call.name,
        arguments=tool_call.arguments,
        forced=True,
    )
    executed_tool = await _execute_agent_tool_call(session, user_id, tool_call)
    await hooks.fire(
        "after_tool",
        run_id=str(run.id),
        session_id=str(run.session_id),
        user_id=user_id,
        tool_name=executed_tool.toolName,
        status=executed_tool.status,
        result=executed_tool.result,
        error=executed_tool.errorMessage,
        forced=True,
    )

    next_run_messages = _append_tool_message(
        run_messages,
        executed_tool,
        created_at=executed_tool.createdAt or _timestamp_ms(_now()),
    )
    next_provider_messages = [
        *provider_messages,
        {
            "role": "user",
            "content": _build_tool_result_prompt([executed_tool]),
        },
    ]
    timeline = [
        TimelineEvent(
            type="tool_start",
            timestamp=tool_started_at,
            data={
                "toolName": executed_tool.toolName,
                "arguments": executed_tool.arguments,
                "forced": True,
            },
        ),
        TimelineEvent(
            type="tool_end",
            timestamp=_iso_timestamp(),
            data={
                "toolName": executed_tool.toolName,
                "success": executed_tool.status == "completed",
                "forced": True,
            },
        ),
    ]
    return [executed_tool], next_run_messages, next_provider_messages, timeline


async def stream_agent_run_record(
    session: AsyncSession,
    user_id: str,
    payload: CreateAgentRunRequest,
) -> AsyncIterator[dict[str, Any]]:
    hooks = get_agent_hook_manager()
    runtime = await resolve_runtime_config_for_user(session, user_id, payload.model)
    session_item = await resolve_run_session(session, user_id, payload)
    persona = await find_user_setting(session, user_id)
    long_term_memory = await build_long_term_memory_context(session, user_id, session_id=str(session_item.id))
    user_system_prompt = payload.systemPrompt if payload.systemPrompt is not None else _extract_system_prompt(persona)
    system_prompt = _build_effective_system_prompt(
        user_system_prompt,
        rag_enabled=payload.ragEnabled,
        session_memory="\n\n".join(
            block for block in [_build_session_memory_block(session_item), long_term_memory] if block.strip()
        ),
    )
    effective_model = runtime.model
    run = await create_agent_run(
        session,
        user_id,
        session_id=str(session_item.id),
        input_text=payload.inputText,
        model=effective_model,
        status="running",
    )
    await update_agent_session(session, user_id, str(session_item.id))
    await hooks.fire(
        "on_run_start",
        run_id=str(run.id),
        session_id=str(session_item.id),
        user_id=user_id,
        model=effective_model,
        input_text=payload.inputText,
    )

    yield build_metadata_event(
        run_id=str(run.id),
        session_id=str(session_item.id),
        model=effective_model,
    )

    user_created_at = _timestamp_ms(run.created_at)
    run_messages = _build_initial_run_messages(
        payload.initialMessages,
        input_text=payload.inputText,
        user_created_at=user_created_at,
        system_prompt=system_prompt,
    )
    provider_messages = _build_provider_messages(payload.initialMessages, payload.inputText, system_prompt)
    pre_executed_tool_calls, run_messages, provider_messages, pre_timeline = await _preexecute_rag_lookup(
        session,
        user_id,
        run,
        hooks,
        payload,
        run_messages=run_messages,
        provider_messages=provider_messages,
    )
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def emit_graph_event(event: dict[str, Any]) -> None:
        await queue.put(event)

    deps = AgentExecutionGraphDependencies(
        stream_completion=lambda runtime_config, messages: _stream_provider_chat_completion(
            runtime_config,
            messages=messages,
        ),
        execute_tool_call=lambda current_session, current_user_id, tool_call: _execute_agent_tool_call(
            current_session,
            current_user_id,
            AgentToolCall(
                id=tool_call.id,
                name=tool_call.name,
                arguments={**tool_call.arguments, "_sessionId": str(session_item.id)},
            ),
        ),
        parse_tool_calls=lambda content: _parse_tool_calls(content, rag_enabled=payload.ragEnabled),
        tool_requires_confirmation=_tool_requires_confirmation,
        build_pending_tool_call=lambda tool_call, created_at: _build_pending_tool_call(
            tool_call,
            created_at=created_at,
        ),
    )

    graph_task = asyncio.create_task(
        run_agent_execution_graph(
            deps=deps,
            session=session,
            user_id=user_id,
            run=run,
            runtime=runtime,
            hooks=hooks,
            run_messages=run_messages,
            provider_messages=provider_messages,
            emit_event=emit_graph_event,
        )
    )

    async for event in drain_background_events(graph_task, queue):
        yield event

    graph_state = await graph_task
    run_messages = graph_state["run_messages"]
    executed_tool_calls = [
        *pre_executed_tool_calls,
        *graph_state["executed_tool_calls"],
    ]
    pending_tool_calls = graph_state["pending_tool_calls"]
    assistant_text_chunks = graph_state["assistant_text_chunks"]
    timeline = [
        *pre_timeline,
        *graph_state["timeline"],
    ]
    final_text = graph_state["final_text"]
    status = graph_state["status"]
    error_message = graph_state["error_message"]
    iteration_count = graph_state["iteration_count"]
    raised_error_message = graph_state["raised_error_message"]

    detail = _build_agent_run_detail(
        run,
        status=status,
        messages=run_messages,
        executed_tool_calls=executed_tool_calls,
        pending_tool_calls=pending_tool_calls,
        final_text=final_text,
        error=error_message,
        iteration_count=iteration_count,
        assistant_text_chunks=assistant_text_chunks,
        timeline=timeline,
    )
    persisted_run = await _persist_run_detail_state(session, user_id, str(run.id), detail)
    final_run = persisted_run or await find_agent_run_by_id(session, user_id, str(run.id)) or run
    final_detail = _bind_detail_to_run(detail, final_run)

    if final_detail.status in {"completed", "waiting_confirmation"}:
        await append_agent_memory_event(
            session,
            user_id,
            session_id=str(final_run.session_id),
            run_id=str(final_run.id),
            detail=final_detail,
        )
    await schedule_memory_refresh_for_detail(
        session,
        user_id,
        str(final_run.session_id),
        final_detail,
        allowed_statuses={"completed", "waiting_confirmation"},
    )
    await fire_run_end_event(
        hooks,
        run_id=str(run.id),
        session_id=str(session_item.id),
        user_id=user_id,
        detail=final_detail,
    )

    if raised_error_message:
        raise RuntimeError(raised_error_message)

    yield build_run_completed_event(final_detail)
