from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AgentRun, AgentSession, UserSetting
from app.schemas.agent import (
    AgentInitialMessage,
    AgentRunDetailDto,
    AgentRunDto,
    AgentRunMessageDto,
    AgentRunToolExecutionDto,
    AgentSessionDetailDto,
    AgentSessionDto,
    TimelineEvent,
)

from app.services.agent._constants import (
    PENDING_CONFIRMATION_TOOL_ID,
    PENDING_CONFIRMATION_TOOL_NAME,
    _iso_timestamp,
    _now,
    _normalize_run_status,
    _timestamp_ms,
)
from app.services.agent._tools import (
    _append_assistant_message,
    _append_tool_message,
    _build_tool_result_prompt,
)
from app.services.agent._memory import _to_agent_session_memory_dto


def _extract_system_prompt(setting: UserSetting | None) -> str:
    preferences = setting.agent_preferences_json if setting else {}
    if not isinstance(preferences, dict):
        return ""
    system_prompt = preferences.get("systemPrompt", "")
    return system_prompt if isinstance(system_prompt, str) else ""


def _filter_initial_messages(messages: list[AgentInitialMessage]) -> list[AgentInitialMessage]:
    return [message for message in messages if message.role in {"user", "assistant", "system"}]


def _to_agent_run_dto(run: AgentRun) -> AgentRunDto:
    return AgentRunDto(
        id=str(run.id),
        sessionId=str(run.session_id),
        status=run.status,
        inputText=run.input_text,
        model=run.model,
        createdAt=_timestamp_ms(run.created_at),
        updatedAt=_timestamp_ms(run.updated_at),
        version=run.version,
    )


def _to_agent_session_dto(session: AgentSession, runs: list[AgentRun]) -> AgentSessionDto:
    return AgentSessionDto(
        id=str(session.id),
        title=session.title,
        createdAt=_timestamp_ms(session.created_at),
        updatedAt=_timestamp_ms(session.updated_at),
        memoryStatus=_to_agent_session_memory_dto(session).status,
        memoryDisabled=bool(session.memory_disabled),
        memoryUpdatedAt=_timestamp_ms(session.memory_updated_at) if session.memory_updated_at else None,
        memoryRunCount=max(int(session.memory_run_count or 0), 0),
        runs=[_to_agent_run_dto(run) for run in runs],
    )


def _model_dump_list(items: list[Any]) -> list[dict[str, Any]]:
    dumped: list[dict[str, Any]] = []
    for item in items:
        if hasattr(item, "model_dump"):
            dumped.append(item.model_dump())
    return dumped


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


def _build_provider_messages(
    initial_messages: list[AgentInitialMessage],
    input_text: str,
    system_prompt: str,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    if system_prompt.strip():
        messages.append({"role": "system", "content": system_prompt})

    for message in _filter_initial_messages(initial_messages):
        messages.append({"role": message.role, "content": message.content})

    messages.append({"role": "user", "content": input_text})
    return messages


def _build_run_messages(
    initial_messages: list[AgentInitialMessage],
    *,
    input_text: str,
    assistant_text: str,
    user_created_at: int,
    assistant_created_at: int,
    system_prompt: str,
) -> list[AgentRunMessageDto]:
    messages: list[AgentRunMessageDto] = []
    if system_prompt.strip():
        messages.append(
            AgentRunMessageDto(
                id=str(uuid4()),
                role="system",
                content=system_prompt,
                createdAt=user_created_at,
            )
        )

    for item in _filter_initial_messages(initial_messages):
        messages.append(
            AgentRunMessageDto(
                id=str(uuid4()),
                role=item.role,
                content=item.content,
                createdAt=user_created_at,
            )
        )

    messages.append(
        AgentRunMessageDto(
            id=str(uuid4()),
            role="user",
            content=input_text,
            createdAt=user_created_at,
        )
    )
    messages.append(
        AgentRunMessageDto(
            id=str(uuid4()),
            role="assistant",
            content=assistant_text,
            createdAt=assistant_created_at,
        )
    )
    return messages


def _build_initial_run_messages(
    initial_messages: list[AgentInitialMessage],
    *,
    input_text: str,
    user_created_at: int,
    system_prompt: str,
) -> list[AgentRunMessageDto]:
    messages: list[AgentRunMessageDto] = []
    if system_prompt.strip():
        messages.append(
            AgentRunMessageDto(
                id=str(uuid4()),
                role="system",
                content=system_prompt,
                createdAt=user_created_at,
            )
        )
    for item in _filter_initial_messages(initial_messages):
        messages.append(
            AgentRunMessageDto(
                id=str(uuid4()),
                role=item.role,
                content=item.content,
                createdAt=user_created_at,
            )
        )
    messages.append(
        AgentRunMessageDto(
            id=str(uuid4()),
            role="user",
            content=input_text,
            createdAt=user_created_at,
        )
    )
    return messages


def _build_stream_run_detail(
    run: AgentRun,
    *,
    status: str,
    messages: list[AgentRunMessageDto],
    final_text: str,
    assistant_text_chunks: list[str],
    error: str | None = None,
) -> AgentRunDetailDto:
    base = _to_agent_run_dto(run)
    payload = base.model_dump()
    payload["status"] = _normalize_run_status(status)
    payload["messages"] = [message.model_dump() for message in messages]
    payload["executedToolCalls"] = []
    payload["pendingToolCalls"] = []
    payload["requiresConfirmation"] = False
    payload["finalText"] = final_text
    payload["error"] = error
    payload["iterationCount"] = 1 if final_text else 0
    payload["assistantTextChunks"] = assistant_text_chunks
    payload["timeline"] = [
        TimelineEvent(
            type="llm_start",
            timestamp=_iso_timestamp(run.created_at),
            data={"model": run.model},
        ).model_dump(),
        TimelineEvent(
            type="llm_end",
            timestamp=_iso_timestamp(run.updated_at),
            data={"model": run.model},
        ).model_dump(),
    ]
    return AgentRunDetailDto(**payload)


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


def _aggregate_session_messages(runs: list[AgentRun]) -> list[AgentRunMessageDto]:
    aggregated: list[AgentRunMessageDto] = []
    for run in runs:
        detail = _to_agent_run_detail(run)
        aggregated.extend(detail.messages)
    return aggregated


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
    # Lazy import to pick up monkeypatched repository functions from the parent module.
    from app.services.agent import update_agent_run
    return await update_agent_run(
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


def _build_rejected_confirmation_run_detail(run: AgentRun) -> AgentRunDetailDto:
    base = _build_run_detail_from_state(run)
    payload = base.model_dump()
    payload["status"] = "cancelled"
    payload["executedToolCalls"] = [_build_rejected_confirmation_tool(run).model_dump()]
    payload["pendingToolCalls"] = []
    payload["requiresConfirmation"] = False
    payload["timeline"] = [
        TimelineEvent(
            type="confirmation",
            timestamp=_iso_timestamp(run.updated_at),
            data={"toolExecutionId": PENDING_CONFIRMATION_TOOL_ID, "decision": "rejected"},
        ).model_dump(),
        TimelineEvent(
            type="interrupted",
            timestamp=_iso_timestamp(run.updated_at),
            data={"reason": "tool_rejected"},
        ).model_dump(),
    ]
    return AgentRunDetailDto(**payload)


def _validate_confirmation_request(run: AgentRun, tool_execution_id: str) -> bool:
    if run.status != "waiting_confirmation":
        raise ValueError("Agent run is not waiting for tool confirmation.")
    return bool(tool_execution_id.strip())


def _find_pending_confirmation_tool(
    detail: AgentRunDetailDto,
    tool_execution_id: str,
) -> AgentRunToolExecutionDto | None:
    for tool in detail.pendingToolCalls:
        if tool.id == tool_execution_id and tool.status == "waiting_confirmation":
            return tool
    return None


def _build_continuation_provider_messages(
    detail: AgentRunDetailDto,
    pending_tool: AgentRunToolExecutionDto,
    executed_tool: AgentRunToolExecutionDto | None = None,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    for message in detail.messages:
        if message.role in {"system", "user", "assistant"}:
            messages.append({"role": message.role, "content": message.content})

    if not messages:
        messages.append({"role": "user", "content": detail.inputText})

    messages.append(
        {
            "role": "system",
            "content": (
                "The user approved the pending action. Continue the conversation from the existing state. "
                "Use only the real tool execution results provided in this conversation. Do not invent extra "
                "tool outputs or claim actions succeeded unless the tool result says so."
            ),
        }
    )
    if executed_tool is None:
        messages.append(
            {
                "role": "user",
                "content": (
                    "Approved pending action:\n"
                    f"- tool: {pending_tool.toolName}\n"
                    f"- arguments: {json.dumps(pending_tool.arguments, ensure_ascii=False)}\n"
                    "The original tool runtime is not available for this pending action in the Python backend. "
                    "Continue conservatively from the available context.\n"
                    "Please continue."
                ),
            }
        )
        return messages

    messages.append(
        {
            "role": "user",
            "content": (
                "Approved pending action and executed tool result:\n"
                f"- tool: {pending_tool.toolName}\n"
                f"- arguments: {json.dumps(pending_tool.arguments, ensure_ascii=False)}\n\n"
                f"{_build_tool_result_prompt([executed_tool])}\n\n"
                "Please continue."
            ),
        }
    )
    return messages


def _build_confirmation_timeline(
    existing: list[TimelineEvent],
    *,
    decision: str,
    model: str,
    executed_tool: AgentRunToolExecutionDto | None = None,
    include_llm_events: bool = True,
) -> list[TimelineEvent]:
    start_timestamp = _iso_timestamp()
    timeline = [
        *existing,
        TimelineEvent(
            type="confirmation",
            timestamp=start_timestamp,
            data={"toolExecutionId": PENDING_CONFIRMATION_TOOL_ID, "decision": decision},
        ),
    ]
    if executed_tool is not None:
        timeline.append(
            TimelineEvent(
                type="tool_start",
                timestamp=start_timestamp,
                data={
                    "toolName": executed_tool.toolName,
                    "arguments": executed_tool.arguments,
                    "confirmed": True,
                },
            )
        )
        timeline.append(
            TimelineEvent(
                type="tool_end",
                timestamp=_iso_timestamp(),
                data={
                    "toolName": executed_tool.toolName,
                    "success": executed_tool.status == "completed",
                    "confirmed": True,
                },
            )
        )
    if include_llm_events:
        timeline.append(
            TimelineEvent(
                type="llm_start",
                timestamp=start_timestamp,
                data={"model": model, "phase": "confirmation_continue"},
            )
        )
        timeline.append(
            TimelineEvent(
                type="llm_end",
                timestamp=_iso_timestamp(),
                data={"model": model, "phase": "confirmation_continue"},
            )
        )
    return timeline


def _build_confirmed_run_detail(
    run: AgentRun,
    current_detail: AgentRunDetailDto,
    pending_tool: AgentRunToolExecutionDto,
    assistant_text: str,
    assistant_text_chunks: list[str],
    executed_tool: AgentRunToolExecutionDto | None = None,
) -> AgentRunDetailDto:
    assistant_created_at = _timestamp_ms(_now())
    confirmed_execution = executed_tool or _build_confirmed_tool_execution(
        pending_tool,
        created_at=assistant_created_at,
    )
    next_messages = list(current_detail.messages)
    if executed_tool is not None:
        next_messages = _append_tool_message(next_messages, executed_tool, created_at=assistant_created_at)
    next_messages = _append_assistant_message(next_messages, assistant_text, created_at=assistant_created_at)
    return AgentRunDetailDto(
        **{
            **_to_agent_run_dto(run).model_dump(),
            "status": "completed",
            "messages": [message.model_dump() for message in next_messages],
            "executedToolCalls": [
                *(execution.model_dump() for execution in current_detail.executedToolCalls),
                confirmed_execution.model_dump(),
            ],
            "pendingToolCalls": [],
            "requiresConfirmation": False,
            "finalText": assistant_text,
            "error": None,
            "iterationCount": max(current_detail.iterationCount, 0) + 1,
            "assistantTextChunks": assistant_text_chunks,
            "timeline": [
                item.model_dump()
                for item in _build_confirmation_timeline(
                    current_detail.timeline,
                    decision="approved",
                    model=run.model,
                    executed_tool=executed_tool,
                )
            ],
        }
    )


def _build_failed_confirmation_run_detail(
    run: AgentRun,
    current_detail: AgentRunDetailDto,
    pending_tool: AgentRunToolExecutionDto,
    assistant_text: str,
    assistant_text_chunks: list[str],
    error_message: str,
    executed_tool: AgentRunToolExecutionDto | None = None,
    include_llm_events: bool = True,
) -> AgentRunDetailDto:
    assistant_created_at = _timestamp_ms(_now())
    confirmed_execution = executed_tool or _build_confirmed_tool_execution(
        pending_tool,
        created_at=assistant_created_at,
    )
    next_messages = list(current_detail.messages)
    if executed_tool is not None:
        next_messages = _append_tool_message(next_messages, executed_tool, created_at=assistant_created_at)
    if assistant_text:
        next_messages = _append_assistant_message(next_messages, assistant_text, created_at=assistant_created_at)
    return AgentRunDetailDto(
        **{
            **_to_agent_run_dto(run).model_dump(),
            "status": "failed",
            "messages": [message.model_dump() for message in next_messages],
            "executedToolCalls": [
                *(execution.model_dump() for execution in current_detail.executedToolCalls),
                confirmed_execution.model_dump(),
            ],
            "pendingToolCalls": [],
            "requiresConfirmation": False,
            "finalText": assistant_text,
            "error": error_message,
            "iterationCount": max(current_detail.iterationCount, 0) + 1,
            "assistantTextChunks": assistant_text_chunks,
            "timeline": [
                *(
                    item.model_dump()
                    for item in _build_confirmation_timeline(
                        current_detail.timeline,
                        decision="approved",
                        model=run.model,
                        executed_tool=executed_tool,
                        include_llm_events=include_llm_events,
                    )
                ),
                TimelineEvent(
                    type="interrupted",
                    timestamp=_iso_timestamp(),
                    data={"reason": "confirmation_continue_failed" if include_llm_events else "confirmed_tool_failed"},
                ).model_dump(),
            ],
        }
    )
