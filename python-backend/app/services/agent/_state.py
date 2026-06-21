from __future__ import annotations

import json

from app.db.models import AgentRun
from app.schemas.agent import AgentRunDetailDto, AgentRunToolExecutionDto, TimelineEvent
from app.services.agent._constants import PENDING_CONFIRMATION_TOOL_ID, _iso_timestamp, _now, _timestamp_ms
from app.services.agent._state_dto import (
    _build_initial_run_messages,
    _build_provider_messages,
    _extract_system_prompt,
    _to_agent_run_dto,
    _to_agent_session_dto,
)
from app.services.agent._state_persistence import (
    _aggregate_session_messages,
    _bind_detail_to_run,
    _build_agent_run_detail,
    _build_confirmed_tool_execution,
    _build_pending_confirmation_tool,
    _build_pending_tool_call,
    _build_rejected_confirmation_tool,
    _build_run_detail_from_state,
    _persist_run_detail_state,
    _to_agent_run_detail,
    _to_agent_session_detail,
)
from app.services.agent._tools import _append_assistant_message, _append_tool_message, _build_tool_result_prompt


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
                    data={
                        "reason": (
                            "confirmation_continue_failed"
                            if include_llm_events
                            else "confirmed_tool_failed"
                        )
                    },
                ).model_dump(),
            ],
        }
    )


__all__ = [
    "_aggregate_session_messages",
    "_bind_detail_to_run",
    "_build_agent_run_detail",
    "_build_confirmed_run_detail",
    "_build_continuation_provider_messages",
    "_build_failed_confirmation_run_detail",
    "_build_initial_run_messages",
    "_build_pending_confirmation_tool",
    "_build_pending_tool_call",
    "_build_provider_messages",
    "_build_rejected_confirmation_run_detail",
    "_build_run_detail_from_state",
    "_extract_system_prompt",
    "_find_pending_confirmation_tool",
    "_persist_run_detail_state",
    "_to_agent_run_detail",
    "_to_agent_run_dto",
    "_to_agent_session_detail",
    "_to_agent_session_dto",
    "_validate_confirmation_request",
]
