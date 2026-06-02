from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator
from typing import TypeVar

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import VersionConflictError
from app.core.provider_crypto import decrypt_provider_secret
from app.db.models import AgentRun, AgentSession
from app.db.session import SessionLocal
from app.repositories.agent import (
    create_agent_run,
    create_agent_session,
    delete_agent_run,
    delete_agent_session,
    find_agent_run_by_id,
    find_agent_session_by_id,
    find_user_setting,
    list_agent_runs,
    list_agent_sessions,
    list_runs_for_session,
    list_runs_for_session_ids,
    update_agent_persona,
    update_agent_run,
    update_agent_session,
)
from app.schemas.agent import (
    AgentCapabilitiesDto,
    AgentDeleteResponse,
    AgentPersonaDto,
    AgentRunDetailDto,
    AgentRunDto,
    AgentRunListResponse,
    AgentRunMessageDto,
    AgentRunToolExecutionDto,
    AgentRuntimeDetailsDto,
    AgentRuntimeProviderDto,
    AgentRuntimeStatusDto,
    AgentSessionDetailDto,
    AgentSessionMemoryDto,
    AgentSessionDto,
    CreateAgentRunRequest,
    CreateAgentSessionRequest,
    ListAgentRunsQuery,
    ListAgentSessionsQuery,
    TimelineEvent,
    UpdateAgentRunRequest,
    UpdateAgentSessionMemorySettingsRequest,
    UpdateAgentSessionRequest,
)
from app.repositories.providers import find_active_provider_for_user

from app.services.agent._constants import (
    ACTIVE_AGENT_RUN_STATUSES,
    DEFAULT_SESSION_TITLE,
    SUPPORTED_STREAM_PROVIDER_FORMATS,
    _generate_session_title,
    _iso_timestamp,
    _now,
    _timestamp_ms,
)
from app.services.agent._provider import (
    _resolve_agent_runtime_config,
    _stream_provider_chat_completion,
)
from app.services.agent.registry import (
    get_agent_hook_manager,
    list_provider_capabilities,
    list_tool_capabilities,
)
from app.services.agent._memory import (
    _build_memory_generation_messages,
    _build_session_memory_block,
    _parse_memory_model_output,
    _select_runs_for_memory_refresh,
    _should_refresh_session_memory,
    _to_agent_session_memory_dto,
)
from app.services.agent._graph import (
    AgentConfirmationGraphDependencies,
    AgentExecutionGraphDependencies,
    run_agent_confirmation_graph,
    run_agent_execution_graph,
)
from app.services.agent._state import (
    _aggregate_session_messages,
    _bind_detail_to_run,
    _build_agent_run_detail,
    _build_confirmed_run_detail,
    _build_continuation_provider_messages,
    _build_failed_confirmation_run_detail,
    _build_initial_run_messages,
    _build_pending_tool_call,
    _build_provider_messages,
    _build_rejected_confirmation_run_detail,
    _extract_system_prompt,
    _find_pending_confirmation_tool,
    _persist_run_detail_state,
    _to_agent_run_detail,
    _to_agent_run_dto,
    _to_agent_session_detail,
    _to_agent_session_dto,
    _validate_confirmation_request,
)
from app.services.agent._tools import (
    _append_assistant_message,
    _append_tool_message,
    _build_effective_system_prompt,
    _build_tool_result_prompt,
    _execute_agent_tool_call,
    _execute_pending_confirmation_tool,
    _parse_tool_calls,
    _tool_requires_confirmation,
)

# Re-export constants, dataclasses, and schema types for test compatibility
from app.services.agent._constants import (  # noqa: F401
    PENDING_CONFIRMATION_TOOL_ID,
    PENDING_CONFIRMATION_TOOL_NAME,
    SUPPORTED_STREAM_PROVIDER_FORMATS,
    AgentModelRuntimeConfig,
    AgentToolCall,
)
from app.schemas.agent import (  # noqa: F401
    AgentRunToolExecutionDto as AgentRunToolExecutionDto,
)

# Re-export provider internals for test monkeypatching
from app.services.agent._provider import (  # noqa: F401
    _stream_openai_chat_completion,
    _stream_anthropic_messages,
    _stream_gemini_generate_content,
    _stream_provider_chat_completion,
    _extract_stream_delta_text,
    _extract_anthropic_stream_delta_text,
    _extract_gemini_stream_delta_text,
)

# Re-export state internals for test monkeypatching
from app.services.agent._state import (  # noqa: F401
    _build_run_detail_from_state,
    _build_pending_confirmation_tool,
    _to_agent_run_detail,
)

# Re-export tools internals for test monkeypatching
from app.services.agent._tools import (  # noqa: F401
    _supported_agent_tool_names,
    _build_effective_system_prompt,
    _execute_agent_tool_call,
    _execute_pending_confirmation_tool,
)

# Re-export repository functions for test monkeypatching
from app.repositories.agent import (  # noqa: F401
    find_agent_session_by_id,
    find_agent_run_by_id,
    find_user_setting,
    list_runs_for_session,
    update_agent_run,
    update_agent_session,
    create_agent_run,
)
from app.repositories.providers import (  # noqa: F401
    find_active_provider_for_user,
)
from app.core.provider_crypto import (  # noqa: F401
    decrypt_provider_secret,
)

logger = logging.getLogger("table-python-backend.agent.memory")
TaskResultT = TypeVar("TaskResultT")


async def _resolve_runtime_config_for_user(
    session: AsyncSession,
    user_id: str,
    requested_model: str,
) -> Any:
    provider = await find_active_provider_for_user(session, user_id)
    if not provider:
        raise RuntimeError("Agent provider is not configured.")
    if provider.api_format not in SUPPORTED_STREAM_PROVIDER_FORMATS:
        raise RuntimeError(
            "Python agent streaming currently supports only anthropic/openai/gemini/custom providers."
        )
    current = get_settings()
    api_key = decrypt_provider_secret(provider.api_key_encrypted, current)
    provider_data = type("ProviderData", (), {
        "id": provider.id,
        "name": provider.name,
        "api_format": provider.api_format,
        "api_key": api_key,
        "base_url": provider.base_url,
        "model": provider.model,
        "headers_json": provider.headers_json,
    })()
    return await _resolve_agent_runtime_config(
        provider_data,
        requested_model=requested_model,
        settings=current,
    )


async def get_agent_runtime_status(session: AsyncSession, user_id: str) -> AgentRuntimeStatusDto:
    provider = await find_active_provider_for_user(session, user_id)
    runtime = AgentRuntimeDetailsDto(
        connected=bool(provider and provider.base_url.strip()),
        selectedModel=(provider.model or "default") if provider else "default",
        availableModels=[provider.model] if provider and provider.model else [],
        provider=AgentRuntimeProviderDto(
            id=str(provider.id),
            name=provider.name,
            apiFormat=provider.api_format,
            baseUrl=provider.base_url,
            hasApiKey=bool(provider.api_key_encrypted),
        )
        if provider
        else None,
    )
    return AgentRuntimeStatusDto(
        ok=runtime.connected,
        module="agent",
        stage="stream-v1",
        runtime=runtime,
    )


async def get_agent_capabilities(_session: AsyncSession, _user_id: str) -> AgentCapabilitiesDto:
    return AgentCapabilitiesDto(
        tools=list_tool_capabilities(),
        providers=list_provider_capabilities(),
    )


async def get_agent_persona(session: AsyncSession, user_id: str) -> AgentPersonaDto:
    setting = await find_user_setting(session, user_id)
    return AgentPersonaDto(systemPrompt=_extract_system_prompt(setting))


async def update_agent_persona_record(
    session: AsyncSession,
    user_id: str,
    payload: AgentPersonaDto,
) -> AgentPersonaDto:
    setting = await update_agent_persona(session, user_id, payload.systemPrompt)
    return AgentPersonaDto(systemPrompt=_extract_system_prompt(setting))


async def get_agent_session_list(
    session: AsyncSession,
    user_id: str,
    query: ListAgentSessionsQuery,
) -> tuple[list[AgentSessionDto], int]:
    items, total = await list_agent_sessions(
        session,
        user_id,
        limit=query.limit,
        offset=query.offset,
    )
    runs_by_session = await list_runs_for_session_ids(session, user_id, [item.id for item in items])
    return [_to_agent_session_dto(item, runs_by_session.get(item.id, [])) for item in items], total


async def get_agent_session_detail(
    session: AsyncSession,
    user_id: str,
    session_id: str,
) -> AgentSessionDetailDto | None:
    item = await find_agent_session_by_id(session, user_id, session_id)
    if not item:
        return None

    runs = await list_runs_for_session(session, user_id, session_id)
    return _to_agent_session_detail(item, runs, _aggregate_session_messages(runs))


async def get_agent_session_memory_record(
    session: AsyncSession,
    user_id: str,
    session_id: str,
) -> AgentSessionMemoryDto | None:
    item = await find_agent_session_by_id(session, user_id, session_id)
    return _to_agent_session_memory_dto(item) if item else None


async def create_agent_session_record(
    session: AsyncSession,
    user_id: str,
    payload: CreateAgentSessionRequest,
) -> AgentSessionDto:
    item = await create_agent_session(session, user_id, payload.title)
    return _to_agent_session_dto(item, [])


async def update_agent_session_record(
    session: AsyncSession,
    user_id: str,
    session_id: str,
    payload: UpdateAgentSessionRequest,
) -> AgentSessionDto | None:
    item = await update_agent_session(session, user_id, session_id, title=payload.title)
    if not item:
        return None

    runs = await list_runs_for_session(session, user_id, session_id)
    return _to_agent_session_dto(item, runs)


async def delete_agent_session_record(
    session: AsyncSession,
    user_id: str,
    session_id: str,
) -> AgentDeleteResponse | None:
    item = await delete_agent_session(session, user_id, session_id)
    if not item:
        return None
    return AgentDeleteResponse(id=str(item.id), deleted=True)


async def delete_agent_session_memory_record(
    session: AsyncSession,
    user_id: str,
    session_id: str,
) -> AgentSessionMemoryDto | None:
    item = await update_agent_session(
        session,
        user_id,
        session_id,
        memory_summary="",
        memory_preferences_json=[],
        memory_facts_json=[],
        memory_goals_json=[],
        memory_todos_json=[],
        memory_rules_json=[],
        memory_status="idle",
        memory_updated_at=None,
        memory_run_count=0,
    )
    return _to_agent_session_memory_dto(item) if item else None


async def update_agent_session_memory_settings_record(
    session: AsyncSession,
    user_id: str,
    session_id: str,
    payload: UpdateAgentSessionMemorySettingsRequest,
) -> AgentSessionMemoryDto | None:
    item = await update_agent_session(
        session,
        user_id,
        session_id,
        memory_disabled=payload.disabled,
    )
    return _to_agent_session_memory_dto(item) if item else None


async def get_agent_run_list(
    session: AsyncSession,
    user_id: str,
    query: ListAgentRunsQuery,
) -> AgentRunListResponse:
    items, total = await list_agent_runs(
        session,
        user_id,
        limit=query.limit,
        offset=query.offset,
        session_id=str(query.sessionId) if query.sessionId else None,
        status=query.status,
    )
    return AgentRunListResponse(
        items=[_to_agent_run_dto(item) for item in items],
        total=total,
        source="persistence",
    )


async def _resolve_run_session(
    session: AsyncSession,
    user_id: str,
    payload: CreateAgentRunRequest,
) -> AgentSession:
    if payload.sessionId:
        session_id = str(payload.sessionId)
        existing = await find_agent_session_by_id(session, user_id, session_id)
        if existing:
            if existing.title == DEFAULT_SESSION_TITLE:
                await update_agent_session(
                    session,
                    user_id,
                    session_id,
                    title=_generate_session_title(payload.inputText),
                )
                refreshed = await find_agent_session_by_id(session, user_id, session_id)
                return refreshed or existing
            return existing

    return await create_agent_session(session, user_id, _generate_session_title(payload.inputText))


async def create_agent_run_record(
    session: AsyncSession,
    user_id: str,
    payload: CreateAgentRunRequest,
) -> AgentRunDetailDto:
    final_run_payload: dict[str, Any] | None = None
    async for event in stream_agent_run_record(session, user_id, payload):
        if event.get("type") == "run_completed":
            final_run_payload = event.get("run") if isinstance(event.get("run"), dict) else None
    if not final_run_payload:
        raise RuntimeError("Agent run did not complete.")
    return AgentRunDetailDto.model_validate(final_run_payload)


async def _collect_completion_text(
    runtime: Any,
    *,
    messages: list[dict[str, str]],
) -> str:
    parts: list[str] = []
    async for token in _stream_provider_chat_completion(runtime, messages=messages):
        parts.append(token)
    return "".join(parts).strip()


async def _refresh_session_memory_record(
    session: AsyncSession,
    user_id: str,
    session_id: str,
) -> None:
    session_item = await find_agent_session_by_id(session, user_id, session_id)
    if not session_item:
        return

    runs = await list_runs_for_session(session, user_id, session_id)
    if not _should_refresh_session_memory(session_item, runs):
        if session_item.memory_status == "pending":
            await update_agent_session(session, user_id, session_id, memory_status="idle")
        return

    await update_agent_session(session, user_id, session_id, memory_status="processing")
    refreshed_session = await find_agent_session_by_id(session, user_id, session_id)
    if not refreshed_session:
        return

    source_runs, eligible_run_count = _select_runs_for_memory_refresh(refreshed_session, runs)
    memory_prompt_messages = _build_memory_generation_messages(refreshed_session, source_runs)
    requested_model = source_runs[-1].model if source_runs else "default"

    try:
        runtime = await _resolve_runtime_config_for_user(session, user_id, requested_model)
        completion_text = await _collect_completion_text(runtime, messages=memory_prompt_messages)
        memory = _parse_memory_model_output(completion_text)
        await update_agent_session(
            session,
            user_id,
            session_id,
            memory_summary=memory.summary,
            memory_preferences_json=list(memory.preferences),
            memory_facts_json=list(memory.facts),
            memory_goals_json=[goal.model_dump() for goal in memory.goals],
            memory_todos_json=[todo.model_dump() for todo in memory.todos],
            memory_rules_json=list(memory.rules),
            memory_status="ready",
            memory_updated_at=_now(),
            memory_run_count=eligible_run_count,
        )
    except Exception:
        logger.exception("Failed to refresh session memory", extra={"session_id": session_id, "user_id": user_id})
        await update_agent_session(
            session,
            user_id,
            session_id,
            memory_status="failed",
        )


async def _refresh_session_memory_task(user_id: str, session_id: str) -> None:
    async with SessionLocal() as background_session:
        await _refresh_session_memory_record(background_session, user_id, session_id)


async def _maybe_schedule_session_memory_refresh(
    session: AsyncSession,
    user_id: str,
    session_id: str,
) -> None:
    try:
        session_item = await find_agent_session_by_id(session, user_id, session_id)
        if not session_item:
            return
        runs = await list_runs_for_session(session, user_id, session_id)
        if not _should_refresh_session_memory(session_item, runs):
            return
        await update_agent_session(session, user_id, session_id, memory_status="pending")
        asyncio.create_task(_refresh_session_memory_task(user_id, session_id))
    except Exception:
        logger.debug(
            "Skipping session memory refresh scheduling",
            exc_info=True,
            extra={"session_id": session_id, "user_id": user_id},
        )


async def _emit_noop_event(_event: dict[str, Any]) -> None:
    return None


async def _drain_background_events(
    task: asyncio.Task[TaskResultT],
    queue: asyncio.Queue[dict[str, Any]],
) -> AsyncIterator[dict[str, Any]]:
    while not task.done() or not queue.empty():
        try:
            event = await asyncio.wait_for(queue.get(), timeout=0.05)
        except TimeoutError:
            continue
        yield event


def _build_metadata_event(*, run_id: str, session_id: str, model: str) -> dict[str, Any]:
    return {
        "type": "metadata",
        "runId": run_id,
        "sessionId": session_id,
        "model": model,
    }


def _build_run_completed_event(detail: AgentRunDetailDto) -> dict[str, Any]:
    return {
        "type": "run_completed",
        "run": detail.model_dump(),
    }


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


async def _fire_run_end_event(
    hooks: Any,
    *,
    run_id: str,
    session_id: str,
    user_id: str,
    detail: AgentRunDetailDto,
    confirmation: bool = False,
) -> None:
    await hooks.fire(
        "on_run_end",
        run_id=run_id,
        session_id=session_id,
        user_id=user_id,
        status=detail.status,
        final_text=detail.finalText,
        confirmation=confirmation,
    )


async def _schedule_memory_refresh_for_detail(
    session: AsyncSession,
    user_id: str,
    session_id: str,
    detail: AgentRunDetailDto,
    *,
    allowed_statuses: set[str],
) -> None:
    if detail.status in allowed_statuses:
        await _maybe_schedule_session_memory_refresh(session, user_id, session_id)


async def stream_agent_run_record(
    session: AsyncSession,
    user_id: str,
    payload: CreateAgentRunRequest,
) -> AsyncIterator[dict[str, Any]]:
    hooks = get_agent_hook_manager()
    runtime = await _resolve_runtime_config_for_user(session, user_id, payload.model)
    session_item = await _resolve_run_session(session, user_id, payload)
    persona = await find_user_setting(session, user_id)
    user_system_prompt = payload.systemPrompt if payload.systemPrompt is not None else _extract_system_prompt(persona)
    system_prompt = _build_effective_system_prompt(
        user_system_prompt,
        rag_enabled=payload.ragEnabled,
        session_memory=_build_session_memory_block(session_item),
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

    yield _build_metadata_event(
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
            tool_call,
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

    async for event in _drain_background_events(graph_task, queue):
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

    await _schedule_memory_refresh_for_detail(
        session,
        user_id,
        str(final_run.session_id),
        final_detail,
        allowed_statuses={"completed", "waiting_confirmation"},
    )
    await _fire_run_end_event(
        hooks,
        run_id=str(run.id),
        session_id=str(session_item.id),
        user_id=user_id,
        detail=final_detail,
    )

    if raised_error_message:
        raise RuntimeError(raised_error_message)

    yield _build_run_completed_event(final_detail)


async def get_agent_run_detail(
    session: AsyncSession,
    user_id: str,
    run_id: str,
) -> AgentRunDetailDto | None:
    run = await find_agent_run_by_id(session, user_id, run_id)
    return _to_agent_run_detail(run) if run else None


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
    final_run = persisted_run or await find_agent_run_by_id(session, user_id, run_id) or run
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
    deps = AgentConfirmationGraphDependencies(
        resolve_runtime=_resolve_runtime_config_for_user,
        stream_completion=lambda runtime_config, messages: _stream_provider_chat_completion(
            runtime_config,
            messages=messages,
        ),
        execute_pending_confirmation_tool=lambda current_session, current_user_id, confirmation_tool: (
            _execute_pending_confirmation_tool(current_session, current_user_id, confirmation_tool)
        ),
        build_continuation_provider_messages=_build_continuation_provider_messages,
        build_confirmed_run_detail=lambda current_run, detail, confirmation_tool, assistant_text, chunks, executed_tool: (
            _build_confirmed_run_detail(
                current_run,
                detail,
                confirmation_tool,
                assistant_text,
                chunks,
                executed_tool=executed_tool,
            )
        ),
        build_failed_confirmation_run_detail=lambda current_run, detail, confirmation_tool, assistant_text, chunks, error_message, executed_tool, include_llm_events: (
            _build_failed_confirmation_run_detail(
                current_run,
                detail,
                confirmation_tool,
                assistant_text,
                chunks,
                error_message,
                executed_tool=executed_tool,
                include_llm_events=include_llm_events,
            )
        ),
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
    await _schedule_memory_refresh_for_detail(
        session,
        user_id,
        str(run.session_id),
        final_detail,
        allowed_statuses={"completed"},
    )
    await _fire_run_end_event(
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
        emit_event=_emit_noop_event,
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

    yield _build_metadata_event(
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

    async for event in _drain_background_events(graph_task, queue):
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
    yield _build_run_completed_event(final_detail)


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
    await _fire_run_end_event(
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

    yield _build_metadata_event(
        run_id=str(run.id),
        session_id=str(run.session_id),
        model=run.model,
    )
    await _fire_run_end_event(
        hooks,
        run_id=run_id,
        session_id=str(run.session_id),
        user_id=user_id,
        detail=final_detail,
        confirmation=True,
    )
    yield _build_run_completed_event(final_detail)


async def update_agent_run_record(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    payload: UpdateAgentRunRequest,
) -> AgentRunDto | None:
    existing = await find_agent_run_by_id(session, user_id, run_id)
    if not existing:
        return None

    updated = await update_agent_run(
        session,
        user_id,
        run_id,
        status=payload.status,
        expected_version=payload.version,
    )
    if not updated:
        raise VersionConflictError("Agent run was modified by another request. Please refresh and try again.")
    return _to_agent_run_dto(updated)


async def delete_agent_run_record(
    session: AsyncSession,
    user_id: str,
    run_id: str,
) -> AgentDeleteResponse | None:
    existing = await find_agent_run_by_id(session, user_id, run_id)
    if not existing:
        return None
    if existing.status in ACTIVE_AGENT_RUN_STATUSES:
        raise ValueError("Cannot delete an agent run while it is still active.")

    deleted = await delete_agent_run(session, user_id, run_id)
    if not deleted:
        return None
    return AgentDeleteResponse(id=str(deleted.id), deleted=True)
