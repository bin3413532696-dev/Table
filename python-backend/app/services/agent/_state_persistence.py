from __future__ import annotations

import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AgentRun, AgentSession
from app.schemas.agent import (
    AgentRunDetailDto,
    AgentRunMessageDto,
    AgentRunToolExecutionDto,
    AgentSessionDetailDto,
    TimelineEvent,
)
import app.services.agent._runtime_support as agent_runtime_support
from app.services.agent._constants import (
    PENDING_CONFIRMATION_TOOL_ID,
    PENDING_CONFIRMATION_TOOL_NAME,
    _iso_timestamp,
    _normalize_run_status,
    _timestamp_ms,
)
from app.services.agent._memory import _to_agent_session_memory_dto
from app.services.agent._state_dto import _model_dump_list, _to_agent_run_dto, _to_agent_session_dto


def _coerce_message_list(value: object) -> list[AgentRunMessageDto]:
    if not isinstance(value, list):
        return []

    messages: list[AgentRunMessageDto] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        try:
            messages.append(AgentRunMessageDto.model_validate(item))
        except Exception:
            continue
    return messages


def _coerce_tool_execution_list(value: object) -> list[AgentRunToolExecutionDto]:
    if not isinstance(value, list):
        return []

    executions: list[AgentRunToolExecutionDto] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        try:
            executions.append(AgentRunToolExecutionDto.model_validate(item))
        except Exception:
            continue
    return executions


def _coerce_timeline_list(value: object) -> list[TimelineEvent]:
    if not isinstance(value, list):
        return []

    timeline: list[TimelineEvent] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        try:
            timeline.append(TimelineEvent.model_validate(item))
        except Exception:
            continue
    return timeline


def _coerce_text_chunks(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _has_persisted_run_state(run: AgentRun) -> bool:
    return any(
        (
            bool(run.messages_json),
            bool(run.executed_tool_calls_json),
            bool(run.pending_tool_calls_json),
            bool(run.assistant_text_chunks_json),
            bool(run.timeline_json),
            bool(run.final_text),
            bool(run.error_text),
            bool(run.iteration_count),
            bool(run.requires_confirmation),
        )
    )


def _build_synthetic_messages_for_run(run: AgentRun) -> list[AgentRunMessageDto]:
    if not run.final_text and run.status not in {"failed", "cancelled"}:
        return []

    messages = [
        AgentRunMessageDto(
            id=f"{run.id}-user",
            role="user",
            content=run.input_text,
            createdAt=_timestamp_ms(run.created_at),
        )
    ]
    if run.final_text:
        messages.append(
            AgentRunMessageDto(
                id=f"{run.id}-assistant",
                role="assistant",
                content=run.final_text,
                createdAt=_timestamp_ms(run.updated_at),
            )
        )
    return messages


def _build_default_timeline(run: AgentRun) -> list[TimelineEvent]:
    if run.status in {"completed", "failed", "cancelled"}:
        return [
            TimelineEvent(
                type="llm_start",
                timestamp=_iso_timestamp(run.created_at),
                data={"model": run.model},
            ),
            TimelineEvent(
                type="llm_end",
                timestamp=_iso_timestamp(run.updated_at),
                data={"model": run.model},
            ),
        ]
    return []


def _bind_detail_to_run(detail: AgentRunDetailDto, run: AgentRun) -> AgentRunDetailDto:
    payload = detail.model_dump()
    payload["id"] = str(run.id)
    payload["sessionId"] = str(run.session_id)
    payload["status"] = _normalize_run_status(run.status)
    payload["inputText"] = run.input_text
    payload["model"] = run.model
    payload["createdAt"] = _timestamp_ms(run.created_at)
    payload["updatedAt"] = _timestamp_ms(run.updated_at)
    payload["version"] = run.version
    return AgentRunDetailDto(**payload)


def _build_pending_confirmation_tool(run: AgentRun) -> AgentRunToolExecutionDto:
    return AgentRunToolExecutionDto(
        id=PENDING_CONFIRMATION_TOOL_ID,
        toolName=PENDING_CONFIRMATION_TOOL_NAME,
        arguments={"inputText": run.input_text},
        status="waiting_confirmation",
        requiresConfirmation=True,
        result={
            "confirmationMessage": (
                "A pending tool confirmation was detected, but the Python backend has not "
                "migrated checkpoint-backed tool resume yet."
            )
        },
        createdAt=_timestamp_ms(run.updated_at),
    )


def _build_rejected_confirmation_tool(run: AgentRun) -> AgentRunToolExecutionDto:
    return AgentRunToolExecutionDto(
        id=PENDING_CONFIRMATION_TOOL_ID,
        toolName=PENDING_CONFIRMATION_TOOL_NAME,
        arguments={"inputText": run.input_text},
        status="failed",
        requiresConfirmation=False,
        errorMessage="Tool execution was rejected before Python backend resumed it.",
        createdAt=_timestamp_ms(run.updated_at),
    )


def _build_confirmed_tool_execution(
    pending_tool: AgentRunToolExecutionDto,
    *,
    created_at: int,
) -> AgentRunToolExecutionDto:
    return AgentRunToolExecutionDto(
        id=pending_tool.id,
        toolName=pending_tool.toolName,
        arguments=pending_tool.arguments,
        status="completed",
        requiresConfirmation=False,
        result={
            "approved": True,
            "note": (
                "Approved on the Python backend continuation path. The original tool runtime "
                "has not been migrated, so continuation used the persisted conversation state."
            ),
        },
        createdAt=created_at,
    )


def _build_pending_tool_call(
    tool_call: Any,
    *,
    created_at: int,
) -> AgentRunToolExecutionDto:
    return AgentRunToolExecutionDto(
        id=tool_call.id,
        toolName=tool_call.name,
        arguments=tool_call.arguments,
        status="waiting_confirmation",
        requiresConfirmation=True,
        result={
            "confirmationMessage": (
                f"即将执行 {tool_call.name}，参数如下：\n"
                f"{json.dumps(tool_call.arguments, ensure_ascii=False, indent=2)}"
            )
        },
        createdAt=created_at,
    )


def _build_run_detail_from_state(run: AgentRun) -> AgentRunDetailDto:
    messages = _coerce_message_list(run.messages_json)
    executed_tool_calls = _coerce_tool_execution_list(run.executed_tool_calls_json)
    pending_tool_calls = _coerce_tool_execution_list(run.pending_tool_calls_json)
    assistant_text_chunks = _coerce_text_chunks(run.assistant_text_chunks_json)
    timeline = _coerce_timeline_list(run.timeline_json)

    if not messages:
        messages = _build_synthetic_messages_for_run(run)
    if not assistant_text_chunks and run.final_text:
        assistant_text_chunks = [run.final_text]
    if not timeline:
        timeline = _build_default_timeline(run)
    if run.status == "waiting_confirmation" and not pending_tool_calls:
        pending_tool_calls = [_build_pending_confirmation_tool(run)]

    requires_confirmation = bool(run.requires_confirmation or pending_tool_calls)
    base = _to_agent_run_dto(run)
    payload = base.model_dump()
    payload["status"] = _normalize_run_status(run.status)
    payload["messages"] = _model_dump_list(messages)
    payload["executedToolCalls"] = _model_dump_list(executed_tool_calls)
    payload["pendingToolCalls"] = _model_dump_list(pending_tool_calls)
    payload["requiresConfirmation"] = requires_confirmation
    payload["finalText"] = run.final_text or ""
    payload["error"] = run.error_text
    payload["iterationCount"] = run.iteration_count or (1 if run.final_text else 0)
    payload["assistantTextChunks"] = assistant_text_chunks
    payload["timeline"] = _model_dump_list(timeline)
    return AgentRunDetailDto(**payload)


def _to_agent_run_detail(run: AgentRun) -> AgentRunDetailDto:
    if run.status == "waiting_confirmation" or _has_persisted_run_state(run):
        return _build_run_detail_from_state(run)

    base = _to_agent_run_dto(run)
    payload = base.model_dump()
    payload["status"] = _normalize_run_status(base.status)
    return AgentRunDetailDto(**payload)


def _aggregate_session_messages(runs: list[AgentRun]) -> list[AgentRunMessageDto]:
    aggregated: list[AgentRunMessageDto] = []
    for run in runs:
        detail = _to_agent_run_detail(run)
        aggregated.extend(detail.messages)
    return aggregated


def _to_agent_session_detail(
    session: AgentSession,
    runs: list[AgentRun],
    messages: list[AgentRunMessageDto] | None = None,
) -> AgentSessionDetailDto:
    base = _to_agent_session_dto(session, runs)
    payload = base.model_dump()
    payload["messages"] = _model_dump_list(messages or [])
    payload["memory"] = _to_agent_session_memory_dto(session).model_dump()
    return AgentSessionDetailDto(**payload)


async def _persist_run_detail_state(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    detail: AgentRunDetailDto,
) -> AgentRun | None:
    return await agent_runtime_support.update_agent_run(
        session,
        user_id,
        run_id,
        status=detail.status,
        messages_json=_model_dump_list(detail.messages),
        executed_tool_calls_json=_model_dump_list(detail.executedToolCalls),
        pending_tool_calls_json=_model_dump_list(detail.pendingToolCalls),
        assistant_text_chunks_json=list(detail.assistantTextChunks),
        timeline_json=_model_dump_list(detail.timeline),
        final_text=detail.finalText,
        error_text=detail.error,
        iteration_count=detail.iterationCount,
        requires_confirmation=detail.requiresConfirmation,
    )


def _build_agent_run_detail(
    run: AgentRun,
    *,
    status: str,
    messages: list[AgentRunMessageDto],
    executed_tool_calls: list[AgentRunToolExecutionDto],
    pending_tool_calls: list[AgentRunToolExecutionDto],
    final_text: str,
    error: str | None,
    iteration_count: int,
    assistant_text_chunks: list[str],
    timeline: list[TimelineEvent],
) -> AgentRunDetailDto:
    payload = _to_agent_run_dto(run).model_dump()
    payload["status"] = _normalize_run_status(status)
    payload["messages"] = _model_dump_list(messages)
    payload["executedToolCalls"] = _model_dump_list(executed_tool_calls)
    payload["pendingToolCalls"] = _model_dump_list(pending_tool_calls)
    payload["requiresConfirmation"] = bool(pending_tool_calls)
    payload["finalText"] = final_text
    payload["error"] = error
    payload["iterationCount"] = iteration_count
    payload["assistantTextChunks"] = list(assistant_text_chunks)
    payload["timeline"] = _model_dump_list(timeline)
    return AgentRunDetailDto(**payload)
