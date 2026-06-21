from __future__ import annotations

from typing import Any
from uuid import uuid4

from app.db.models import AgentRun, AgentSession, UserSetting
from app.schemas.agent import (
    AgentInitialMessage,
    AgentRunDetailDto,
    AgentRunDto,
    AgentRunMessageDto,
    AgentSessionDto,
    TimelineEvent,
)
from app.services.agent._constants import _iso_timestamp, _normalize_run_status, _timestamp_ms
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
