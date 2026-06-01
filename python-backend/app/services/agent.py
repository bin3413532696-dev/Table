from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import re
from typing import Any, AsyncIterator
from uuid import uuid4

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import VersionConflictError
from app.core.provider_crypto import decrypt_provider_secret
from app.db.models import AgentRun, AgentSession, UserSetting
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
from app.repositories.providers import find_active_provider_for_user
from app.repositories.tasks import (
    create_task as create_task_repo,
    delete_task as delete_task_repo,
    find_task_by_id,
    update_task as update_task_repo,
)
from app.repositories.finance import create_finance_record as create_finance_record_repo
from app.repositories.finance import list_finance_records as list_finance_records_repo
from app.repositories.knowledge import normalize_tags as normalize_note_tags
from app.repositories.knowledge import search_notes as search_notes_repo
from app.schemas.agent import (
    AgentDeleteResponse,
    AgentInitialMessage,
    AgentMessageRole,
    AgentPersonaDto,
    AgentRunDetailDto,
    AgentRunDto,
    AgentRunToolExecutionDto,
    AgentRunListResponse,
    AgentRunMessageDto,
    AgentRuntimeDetailsDto,
    AgentRuntimeProviderDto,
    AgentRuntimeStatusDto,
    AgentSessionDetailDto,
    AgentSessionDto,
    CreateAgentRunRequest,
    CreateAgentSessionRequest,
    ListAgentRunsQuery,
    ListAgentSessionsQuery,
    TimelineEvent,
    UpdateAgentRunRequest,
    UpdateAgentSessionRequest,
)
from app.repositories.knowledge_rag import get_chunk_by_id as get_rag_chunk_by_id
from app.repositories.tasks import list_tasks as list_tasks_repo
from app.schemas.finance import CreateFinanceRecordRequest
from app.schemas.knowledge import NoteSearchQuery
from app.schemas.knowledge_rag import HybridSearchRequest
from app.schemas.task import CreateTaskRequest, UpdateTaskRequest
from app.services.api_urls import build_v1_api_url
from app.services.knowledge_rag import build_search_context, search_service, search_with_context_service
from app.services.providers import get_active_provider_service
from app.services.tasks import to_task_response
from app.services.finance import to_finance_record_response

DEFAULT_SESSION_TITLE = "新会话"
ACTIVE_AGENT_RUN_STATUSES = {"running", "waiting_confirmation"}
KNOWN_RUN_STATUSES = {
    "pending",
    "running",
    "waiting_confirmation",
    "completed",
    "failed",
    "cancelled",
}
SUPPORTED_STREAM_PROVIDER_FORMATS = {"anthropic", "openai", "gemini", "custom"}
ANTHROPIC_API_VERSION = "2023-06-01"
PENDING_CONFIRMATION_TOOL_ID = "pending-confirmation"
PENDING_CONFIRMATION_TOOL_NAME = "pending_confirmation"
MAX_AGENT_ITERATIONS = 5
TOOL_BLOCK_REGEX = re.compile(r"```tool\s*\n?([\s\S]*?)```", re.IGNORECASE)
JSON_BLOCK_REGEX = re.compile(r"```json\s*\n?([\s\S]*?)```", re.IGNORECASE)


@dataclass(frozen=True)
class AgentToolCall:
    id: str
    name: str
    arguments: dict[str, object]


@dataclass(frozen=True)
class AgentModelRuntimeConfig:
    api_format: str
    api_key: str
    base_url: str
    model: str
    timeout_ms: int
    headers: dict[str, str]
    provider_id: str
    provider_name: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _timestamp_ms(value: datetime | None) -> int:
    return int((value or _now()).timestamp() * 1000)


def _iso_timestamp(value: datetime | None = None) -> str:
    return (value or _now()).isoformat()


def _normalize_run_status(value: str) -> str:
    return value if value in KNOWN_RUN_STATUSES else "pending"


def _generate_session_title(input_text: str) -> str:
    trimmed = input_text.strip()
    if not trimmed:
        return DEFAULT_SESSION_TITLE
    if len(trimmed) <= 40:
        return trimmed
    return f"{trimmed[:40]}..."


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
        runs=[_to_agent_run_dto(run) for run in runs],
    )


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
    return AgentSessionDetailDto(**payload)


def _extract_system_prompt(setting: UserSetting | None) -> str:
    preferences = setting.agent_preferences_json if setting else {}
    if not isinstance(preferences, dict):
        return ""
    system_prompt = preferences.get("systemPrompt", "")
    return system_prompt if isinstance(system_prompt, str) else ""


def _to_string_record(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if isinstance(key, str) and isinstance(item, str)}


def _normalize_model(payload_model: str, provider_model: str | None) -> str:
    if payload_model != "default":
        return payload_model
    return (provider_model or "").strip() or "default"


def _filter_initial_messages(messages: list[AgentInitialMessage]) -> list[AgentInitialMessage]:
    return [message for message in messages if message.role in {"user", "assistant", "system"}]


def _tool_requires_confirmation(tool_name: str) -> bool:
    return tool_name in {"create_task", "add_finance_record", "update_task", "delete_task"}


def _supported_agent_tool_names(*, rag_enabled: bool) -> list[str]:
    tool_names = [
        "query_tasks",
        "get_task_stats",
        "query_finance",
        "get_finance_stats",
        "search_knowledge",
        "create_task",
        "add_finance_record",
        "update_task",
        "delete_task",
    ]
    if rag_enabled:
        tool_names.extend(
            [
                "search_knowledge_rag",
                "semantic_search",
                "keyword_search",
                "chunk_read",
                "cite_sources",
                "rag_answer",
            ]
        )
    return tool_names


def _build_effective_system_prompt(user_prompt: str, *, rag_enabled: bool) -> str:
    query_tools = [
        "query_tasks(completed?, priority?, limit?)",
        "get_task_stats()",
        "query_finance(type?, category?, startDate?, endDate?, limit?)",
        "get_finance_stats()",
        "search_knowledge(query?, tags?, limit?)",
    ]
    rag_tools = [
        "search_knowledge_rag(query!, limit?)",
        "semantic_search(query!, tags?, documentIds?, limit?)",
        "keyword_search(query!, limit?)",
        "chunk_read(chunkId!)",
        "cite_sources(chunkIds!)",
        "rag_answer(question!, tags?, limit?)",
    ]
    write_tools = [
        "create_task(title!, priority?, dueDate?, description?)",
        "add_finance_record(type!, amount!, description!, category!, date!)",
        "update_task(id!, title?, completed?, priority?, dueDate?)",
        "delete_task(id!)",
    ]
    tool_lines = [*query_tools, *rag_tools] if rag_enabled else list(query_tools)
    tool_lines.extend(write_tools)
    tool_list = "\n".join(f"- {line}" for line in tool_lines)
    base_prompt = (
        "你是个人工作台智能助手。你必须严格基于工具结果回答，不要编造未执行的操作或未检索到的信息。\n\n"
        "可用工具：\n"
        f"{tool_list}\n\n"
        "工具调用规则：\n"
        "1. 需要调用工具时，必须只输出一个工具调用代码块，然后停止继续输出。\n"
        "2. 代码块格式必须是：```tool {\"name\": \"工具名\", \"arguments\": {...}} ```。\n"
        "3. 查询类工具直接调用；写操作工具需要用户确认。\n"
        "4. 收到工具结果后，再根据结果继续回答。\n"
        "5. 缺少关键参数时先向用户提问，不要猜。\n"
        "6. 使用简体中文，简洁直接。\n"
    )
    if rag_enabled:
        base_prompt += (
            "7. 回答知识库文档问题时，优先使用 rag_answer；如果使用 semantic_search 或 keyword_search，"
            "请在最终回答前调用 cite_sources 标注引用的 chunkIds。\n"
        )
    # Override the legacy mojibake prompt with a clean, current instruction set.
    base_prompt = (
        "你是个人工作站智能助手。你必须严格基于工具结果回答，不要编造未执行的操作或未检索到的信息。\n\n"
        "可用工具：\n"
        f"{tool_list}\n\n"
        "工具调用规则：\n"
        "1. 需要调用工具时，必须只输出一个工具调用代码块，然后停止继续输出。\n"
        "2. 代码块格式必须是：```tool {\"name\": \"工具名\", \"arguments\": {...}} ```。\n"
        "3. 查询类工具直接调用；写操作工具需要用户确认。\n"
        "4. 收到工具结果后，再根据结果继续回答。\n"
        "5. 缺少关键参数时先向用户提问，不要猜测。\n"
        "6. 如果用户是在询问如何使用某个工具、需要哪些参数、或请求解释/示例，而不是要求你执行该操作，直接回答，不要调用任何工具。\n"
        "7. 使用简体中文，简洁直接。\n"
    )
    if rag_enabled:
        base_prompt += (
            "8. 回答知识库文档问题时，优先使用 rag_answer；如果使用 semantic_search 或 keyword_search，请在最终回答前调用 cite_sources 标注引用的 chunkIds。\n"
        )
    if user_prompt.strip():
        return f"{user_prompt.strip()}\n\n{base_prompt}"
    return base_prompt


def _content_to_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
            continue
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if isinstance(text, str):
            parts.append(text)
    return "".join(parts)


def _extract_inline_tool_json(content: str) -> list[str]:
    candidates: list[str] = []
    search_start = 0
    while search_start < len(content):
        name_index = content.find('"name"', search_start)
        if name_index == -1:
            break
        start = content.rfind("{", 0, name_index + 1)
        if start == -1:
            break

        depth = 0
        in_string = False
        escaped = False
        end = -1
        for index in range(start, len(content)):
            char = content[index]
            if escaped:
                escaped = False
                continue
            if char == "\\":
                escaped = True
                continue
            if char == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    end = index
                    break

        if end == -1:
            break
        candidate = content[start : end + 1].strip()
        if '"arguments"' in candidate:
            candidates.append(candidate)
        search_start = end + 1

    return candidates


def _parse_tool_calls(content: str, *, rag_enabled: bool) -> tuple[str, list[AgentToolCall]]:
    tool_calls: list[AgentToolCall] = []
    supported_names = set(_supported_agent_tool_names(rag_enabled=rag_enabled))

    for regex in (TOOL_BLOCK_REGEX, JSON_BLOCK_REGEX):
        for match in regex.finditer(content):
            try:
                parsed = json.loads(match.group(1).strip())
            except json.JSONDecodeError:
                continue
            name = parsed.get("name")
            arguments = parsed.get("arguments", {})
            if isinstance(name, str) and isinstance(arguments, dict) and name in supported_names:
                tool_calls.append(
                    AgentToolCall(
                        id=str(uuid4()),
                        name=name,
                        arguments={key: value for key, value in arguments.items() if isinstance(key, str)},
                    )
                )

    for candidate in _extract_inline_tool_json(content):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        name = parsed.get("name")
        arguments = parsed.get("arguments", {})
        if isinstance(name, str) and isinstance(arguments, dict) and name in supported_names:
            tool_calls.append(
                AgentToolCall(
                    id=str(uuid4()),
                    name=name,
                    arguments={key: value for key, value in arguments.items() if isinstance(key, str)},
                )
            )

    seen: set[str] = set()
    unique_tool_calls: list[AgentToolCall] = []
    for tool_call in tool_calls:
        key = f"{tool_call.name}:{json.dumps(tool_call.arguments, ensure_ascii=True, sort_keys=True)}"
        if key in seen:
            continue
        seen.add(key)
        unique_tool_calls.append(tool_call)

    text_content = TOOL_BLOCK_REGEX.sub("", content)
    text_content = JSON_BLOCK_REGEX.sub("", text_content)
    text_content = re.sub(r'\{"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}', "", text_content)
    return text_content.strip(), unique_tool_calls


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


async def _persist_run_detail_state(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    detail: AgentRunDetailDto,
) -> AgentRun | None:
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


def _normalize_task_priority(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    priority_map = {
        "low": "low",
        "medium": "medium",
        "high": "high",
        "l": "low",
        "m": "medium",
        "h": "high",
        "low priority": "low",
        "medium priority": "medium",
        "high priority": "high",
        "低": "low",
        "低优先级": "low",
        "中": "medium",
        "中等": "medium",
        "中优先级": "medium",
        "默认": "medium",
        "高": "high",
        "高优先级": "high",
        "重要": "high",
        "紧急": "high",
    }
    return priority_map.get(normalized)


def _string_or_none(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


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


def _build_pending_tool_call(
    tool_call: AgentToolCall,
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


def _build_chunk_read_result(chunk: dict[str, object] | None, *, error_message: str | None = None) -> str:
    if error_message:
        return f"<chunk_read_result><error>{error_message}</error></chunk_read_result>"
    if not chunk:
        return "<chunk_read_result><error>未找到 chunk</error></chunk_read_result>"

    document_title = str(chunk.get("document_title") or "")
    heading_chain = _string_or_none(chunk.get("heading_chain"))
    source = f"{document_title} > {heading_chain}" if heading_chain else document_title
    content = str(chunk.get("content") or "")
    return (
        "<chunk_read_result>\n"
        f"<chunk_id>{chunk.get('id')}</chunk_id>\n"
        f"<document_title>{document_title}</document_title>\n"
        f"<source>{source}</source>\n"
        f"<content>{content}</content>\n"
        "</chunk_read_result>"
    )


async def _execute_agent_tool_call(
    session: AsyncSession,
    user_id: str,
    tool_call: AgentToolCall,
    *,
    settings: Settings | None = None,
) -> AgentRunToolExecutionDto:
    created_at = _timestamp_ms(_now())
    current = settings or get_settings()

    try:
        if tool_call.name == "query_tasks":
            tasks = await list_tasks_repo(session, user_id)
            completed_filter = tool_call.arguments.get("completed")
            priority_filter = _normalize_task_priority(tool_call.arguments.get("priority"))
            limit = int(tool_call.arguments.get("limit") or 20)
            results = [
                to_task_response(task).model_dump()
                for task in tasks
                if (completed_filter is None or task.completed == completed_filter)
                and (priority_filter is None or task.priority == priority_filter)
            ][:limit]
            result: object = results
        elif tool_call.name == "get_task_stats":
            tasks = await list_tasks_repo(session, user_id)
            completed_count = sum(1 for task in tasks if task.completed)
            today = _now().date()
            overdue_count = sum(
                1 for task in tasks if task.due_date is not None and not task.completed and task.due_date < today
            )
            result = {
                "total": len(tasks),
                "completed": completed_count,
                "pending": len(tasks) - completed_count,
                "overdue": overdue_count,
            }
        elif tool_call.name == "query_finance":
            records = await list_finance_records_repo(session, user_id)
            type_filter = _string_or_none(tool_call.arguments.get("type")) or "all"
            category_filter = _string_or_none(tool_call.arguments.get("category"))
            start_date = _string_or_none(tool_call.arguments.get("startDate"))
            end_date = _string_or_none(tool_call.arguments.get("endDate"))
            limit = int(tool_call.arguments.get("limit") or 50)
            filtered_records = records
            if type_filter != "all":
                filtered_records = [record for record in filtered_records if record.type == type_filter]
            if category_filter:
                filtered_records = [record for record in filtered_records if record.category == category_filter]
            if start_date:
                start_value = datetime.fromisoformat(start_date).date()
                filtered_records = [record for record in filtered_records if record.record_date >= start_value]
            if end_date:
                end_value = datetime.fromisoformat(end_date).date()
                filtered_records = [record for record in filtered_records if record.record_date <= end_value]
            result = [to_finance_record_response(record).model_dump() for record in filtered_records[:limit]]
        elif tool_call.name == "get_finance_stats":
            records = await list_finance_records_repo(session, user_id)
            total_income = sum(float(record.amount) for record in records if record.type == "income")
            total_expense = sum(float(record.amount) for record in records if record.type == "expense")
            result = {
                "totalRecords": len(records),
                "totalIncome": total_income,
                "totalExpense": total_expense,
                "balance": total_income - total_expense,
            }
        elif tool_call.name == "search_knowledge":
            tags_arg = tool_call.arguments.get("tags")
            tags = normalize_note_tags([tags_arg] if isinstance(tags_arg, str) else tags_arg)
            rows = await search_notes_repo(
                session,
                user_id,
                query=_string_or_none(tool_call.arguments.get("query")) or "",
                tags=tags,
                limit=int(tool_call.arguments.get("limit") or 8),
                offset=0,
            )
            result = rows
        elif tool_call.name == "search_knowledge_rag":
            query = _string_or_none(tool_call.arguments.get("query"))
            if not query:
                result = {"context": "", "results": [], "message": "请提供查询内容。"}
            else:
                payload = HybridSearchRequest(
                    query=query,
                    limit=int(tool_call.arguments.get("limit") or 10),
                    mode="semantic",
                    enableQueryPreprocess=True,
                    enableRewrite=True,
                    enableRerank=current.reranker_enabled,
                    enableMmr=current.mmr_enabled,
                )
                result = await search_with_context_service(session, user_id, payload, settings=current)
        elif tool_call.name == "semantic_search":
            payload = HybridSearchRequest(
                query=_string_or_none(tool_call.arguments.get("query")) or "",
                tags=tool_call.arguments.get("tags") if isinstance(tool_call.arguments.get("tags"), list) else None,
                documentIds=tool_call.arguments.get("documentIds")
                if isinstance(tool_call.arguments.get("documentIds"), list)
                else None,
                limit=int(tool_call.arguments.get("limit") or 10),
                mode="semantic",
                enableQueryPreprocess=current.query_preprocessor_enabled,
                enableRewrite=True,
                enableRerank=current.reranker_enabled,
                enableMmr=current.mmr_enabled,
            )
            result = (await search_service(session, user_id, payload, settings=current)).model_dump()
        elif tool_call.name == "keyword_search":
            payload = HybridSearchRequest(
                query=_string_or_none(tool_call.arguments.get("query")) or "",
                limit=int(tool_call.arguments.get("limit") or 10),
                mode="keyword",
            )
            result = (await search_service(session, user_id, payload, settings=current)).model_dump()
        elif tool_call.name == "chunk_read":
            chunk_id = _string_or_none(tool_call.arguments.get("chunkId"))
            if not chunk_id:
                raise ValueError("chunk_read requires chunkId.")
            chunk = await get_rag_chunk_by_id(session, user_id, chunk_id)
            result = _build_chunk_read_result(chunk, error_message=None if chunk else f"未找到 chunk: {chunk_id}")
        elif tool_call.name == "cite_sources":
            chunk_ids = tool_call.arguments.get("chunkIds")
            if not isinstance(chunk_ids, list) or not all(isinstance(item, str) for item in chunk_ids):
                raise ValueError("cite_sources requires chunkIds.")
            result = {
                "cited": chunk_ids,
                "count": len(chunk_ids),
                "message": f"已标注 {len(chunk_ids)} 个来源引用。",
            }
        elif tool_call.name == "rag_answer":
            question = _string_or_none(tool_call.arguments.get("question"))
            if not question:
                result = {
                    "context": "",
                    "sources": [],
                    "confidence": 0,
                    "message": "请提供查询内容。",
                }
            else:
                payload = HybridSearchRequest(
                    query=question,
                    tags=tool_call.arguments.get("tags") if isinstance(tool_call.arguments.get("tags"), list) else None,
                    limit=int(tool_call.arguments.get("limit") or 10),
                    mode="semantic",
                    enableQueryPreprocess=current.query_preprocessor_enabled,
                    enableRewrite=True,
                    enableRerank=current.reranker_enabled,
                    enableMmr=current.mmr_enabled,
                )
                response = await search_service(session, user_id, payload, settings=current)
                if not response.results:
                    result = {
                        "context": "知识库未找到相关内容",
                        "sources": [],
                        "confidence": 0,
                        "message": "未找到相关结果，请尝试其他查询方式。",
                        "searched": True,
                    }
                else:
                    max_score = max(result_item.score for result_item in response.results)
                    confidence = min(max_score * 0.7 + min(len(response.results) / 10, 0.3), 1.0)
                    result = {
                        "context": build_search_context(response.results, max_chars=3000),
                        "sources": [
                            {
                                "chunkId": result_item.id,
                                "documentTitle": result_item.documentTitle,
                                "score": result_item.score,
                            }
                            for result_item in response.results
                        ],
                        "confidence": round(confidence, 2),
                        "message": f"找到 {len(response.results)} 条相关内容，置信度 {(confidence * 100):.0f}%",
                        "searched": True,
                        "maxScore": max_score,
                    }
        else:
            raise ValueError(f"Unsupported agent tool: {tool_call.name}")
    except Exception as exc:
        return AgentRunToolExecutionDto(
            id=tool_call.id,
            toolName=tool_call.name,
            arguments=tool_call.arguments,
            status="failed",
            requiresConfirmation=False,
            errorMessage=str(exc),
            createdAt=created_at,
        )

    if isinstance(result, str):
        result_payload: dict[str, object] = {"textContent": result}
    elif isinstance(result, dict):
        result_payload = {key: value for key, value in result.items() if isinstance(key, str)}
    else:
        result_payload = {"value": result}

    return AgentRunToolExecutionDto(
        id=tool_call.id,
        toolName=tool_call.name,
        arguments=tool_call.arguments,
        status="completed",
        requiresConfirmation=False,
        result=result_payload,
        createdAt=created_at,
    )


def _build_tool_result_prompt(executed_tool_calls: list[AgentRunToolExecutionDto]) -> str:
    if not executed_tool_calls:
        return ""

    blocks: list[str] = []
    for tool_call in executed_tool_calls:
        if tool_call.status == "completed":
            result_payload = json.dumps(tool_call.result or {}, ensure_ascii=False, indent=2)
            blocks.append(f"Tool {tool_call.toolName} executed successfully:\n{result_payload}")
        else:
            blocks.append(
                f"Tool {tool_call.toolName} failed:\n{tool_call.errorMessage or 'Unknown tool execution error.'}"
            )

    joined_blocks = "\n\n".join(blocks)
    return (
        "The following tool execution results are available. Continue the conversation using only these real "
        f"results:\n\n{joined_blocks}"
    )


def _append_tool_message(
    messages: list[AgentRunMessageDto],
    executed_tool: AgentRunToolExecutionDto,
    *,
    created_at: int,
) -> list[AgentRunMessageDto]:
    next_messages = list(messages)
    next_messages.append(
        AgentRunMessageDto(
            id=str(uuid4()),
            role="tool",
            content=_build_tool_result_prompt([executed_tool]),
            createdAt=created_at,
        )
    )
    return next_messages


async def _execute_pending_confirmation_tool(
    session: AsyncSession,
    user_id: str,
    pending_tool: AgentRunToolExecutionDto,
) -> AgentRunToolExecutionDto | None:
    if pending_tool.toolName == PENDING_CONFIRMATION_TOOL_NAME:
        return None

    created_at = _timestamp_ms(_now())
    try:
        if pending_tool.toolName == "create_task":
            payload = CreateTaskRequest.model_validate(
                {
                    "title": pending_tool.arguments.get("title"),
                    "priority": _normalize_task_priority(pending_tool.arguments.get("priority")) or "medium",
                    "dueDate": _string_or_none(pending_tool.arguments.get("dueDate")),
                    "notes": _string_or_none(
                        pending_tool.arguments.get("notes") or pending_tool.arguments.get("description")
                    ),
                }
            )
            task = await create_task_repo(session, user_id, payload.model_dump(exclude_none=True))
            return AgentRunToolExecutionDto(
                id=pending_tool.id,
                toolName=pending_tool.toolName,
                arguments=pending_tool.arguments,
                status="completed",
                requiresConfirmation=False,
                result=to_task_response(task).model_dump(),
                createdAt=created_at,
            )

        if pending_tool.toolName == "add_finance_record":
            payload = CreateFinanceRecordRequest.model_validate(
                {
                    "type": pending_tool.arguments.get("type"),
                    "amount": pending_tool.arguments.get("amount"),
                    "description": pending_tool.arguments.get("description"),
                    "category": pending_tool.arguments.get("category"),
                    "date": pending_tool.arguments.get("date"),
                }
            )
            record = await create_finance_record_repo(session, user_id, payload.model_dump(exclude_none=True))
            return AgentRunToolExecutionDto(
                id=pending_tool.id,
                toolName=pending_tool.toolName,
                arguments=pending_tool.arguments,
                status="completed",
                requiresConfirmation=False,
                result=to_finance_record_response(record).model_dump(),
                createdAt=created_at,
            )

        if pending_tool.toolName == "update_task":
            task_id = _string_or_none(pending_tool.arguments.get("id"))
            if not task_id:
                raise ValueError("update_task requires a task id.")
            existing = await find_task_by_id(session, user_id, task_id)
            if not existing:
                raise ValueError(f"Task not found: {task_id}")

            payload = UpdateTaskRequest.model_validate(
                {
                    "title": _string_or_none(pending_tool.arguments.get("title")),
                    "priority": _normalize_task_priority(pending_tool.arguments.get("priority")),
                    "dueDate": _string_or_none(pending_tool.arguments.get("dueDate")),
                    "completed": pending_tool.arguments.get("completed"),
                    "version": existing.version,
                }
            )
            updated = await update_task_repo(
                session,
                user_id,
                task_id,
                payload.version,
                payload.model_dump(exclude_unset=True, exclude={"version"}),
            )
            if not updated:
                raise RuntimeError("Task was modified by another request. Please refresh and try again.")
            return AgentRunToolExecutionDto(
                id=pending_tool.id,
                toolName=pending_tool.toolName,
                arguments=pending_tool.arguments,
                status="completed",
                requiresConfirmation=False,
                result=to_task_response(updated).model_dump(),
                createdAt=created_at,
            )

        if pending_tool.toolName == "delete_task":
            task_id = _string_or_none(pending_tool.arguments.get("id"))
            if not task_id:
                raise ValueError("delete_task requires a task id.")
            deleted = await delete_task_repo(session, user_id, task_id)
            if not deleted:
                raise ValueError(f"Task not found: {task_id}")
            return AgentRunToolExecutionDto(
                id=pending_tool.id,
                toolName=pending_tool.toolName,
                arguments=pending_tool.arguments,
                status="completed",
                requiresConfirmation=False,
                result={"id": task_id, "deleted": True},
                createdAt=created_at,
            )
    except Exception as exc:
        return AgentRunToolExecutionDto(
            id=pending_tool.id,
            toolName=pending_tool.toolName,
            arguments=pending_tool.arguments,
            status="failed",
            requiresConfirmation=False,
            errorMessage=str(exc),
            createdAt=created_at,
        )

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


def _append_assistant_message(
    messages: list[AgentRunMessageDto],
    content: str,
    *,
    created_at: int,
) -> list[AgentRunMessageDto]:
    next_messages = list(messages)
    next_messages.append(
        AgentRunMessageDto(
            id=str(uuid4()),
            role="assistant",
            content=content,
            createdAt=created_at,
        )
    )
    return next_messages


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


def _extract_stream_delta_text(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        return ""
    delta = first_choice.get("delta")
    if not isinstance(delta, dict):
        return ""
    return _content_to_text(delta.get("content"))


def _extract_anthropic_stream_delta_text(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    if payload.get("type") != "content_block_delta":
        return ""
    delta = payload.get("delta")
    if not isinstance(delta, dict):
        return ""
    if delta.get("type") != "text_delta":
        return ""
    text = delta.get("text")
    return text if isinstance(text, str) else ""


def _extract_gemini_stream_delta_text(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""
    first_candidate = candidates[0]
    if not isinstance(first_candidate, dict):
        return ""
    content = first_candidate.get("content")
    if not isinstance(content, dict):
        return ""
    parts = content.get("parts")
    return _content_to_text(parts)


def _split_system_messages(messages: list[dict[str, str]]) -> tuple[str, list[dict[str, str]]]:
    system_parts: list[str] = []
    provider_messages: list[dict[str, str]] = []
    for message in messages:
        role = message.get("role")
        content = message.get("content", "")
        if role == "system":
            if content.strip():
                system_parts.append(content)
            continue
        if role in {"user", "assistant"}:
            provider_messages.append({"role": role, "content": content})
    return "\n\n".join(system_parts), provider_messages


def _to_gemini_role(role: str) -> str:
    return "model" if role == "assistant" else "user"


def _build_gemini_stream_url(base_url: str, model: str) -> str:
    normalized_base_url = base_url.rstrip("/")
    if normalized_base_url.endswith(":streamGenerateContent"):
        separator = "&" if "?" in normalized_base_url else "?"
        return f"{normalized_base_url}{separator}alt=sse"
    if normalized_base_url.endswith("/models"):
        return f"{normalized_base_url}/{model}:streamGenerateContent?alt=sse"
    if normalized_base_url.endswith(f"/models/{model}"):
        return f"{normalized_base_url}:streamGenerateContent?alt=sse"
    if normalized_base_url.endswith("/v1beta") or normalized_base_url.endswith("/v1"):
        return f"{normalized_base_url}/models/{model}:streamGenerateContent?alt=sse"
    return f"{normalized_base_url}/v1beta/models/{model}:streamGenerateContent?alt=sse"


async def _iter_sse_events(response: httpx.Response) -> AsyncIterator[tuple[str | None, str]]:
    event_type: str | None = None
    data_lines: list[str] = []
    async for line in response.aiter_lines():
        stripped = line.strip()
        if not stripped:
            if data_lines:
                yield event_type, "\n".join(data_lines).strip()
            event_type = None
            data_lines = []
            continue
        if stripped.startswith(":"):
            continue
        if stripped.startswith("event:"):
            event_type = stripped[6:].strip() or None
            continue
        if stripped.startswith("data:"):
            data_lines.append(stripped[5:].strip())

    if data_lines:
        yield event_type, "\n".join(data_lines).strip()


async def _resolve_agent_runtime_config(
    session: AsyncSession,
    user_id: str,
    *,
    requested_model: str,
    settings: Settings | None = None,
) -> AgentModelRuntimeConfig:
    current = settings or get_settings()
    provider = await find_active_provider_for_user(session, user_id)
    if not provider:
        raise RuntimeError("Agent provider is not configured.")
    if provider.api_format not in SUPPORTED_STREAM_PROVIDER_FORMATS:
        raise RuntimeError(
            "Python agent streaming currently supports only anthropic/openai/gemini/custom providers."
        )

    api_key = decrypt_provider_secret(provider.api_key_encrypted, current)
    base_url = (provider.base_url or "").strip().rstrip("/")
    model = _normalize_model(requested_model, provider.model)
    if not api_key:
        raise RuntimeError("Agent provider API key is not configured.")
    if not base_url:
        raise RuntimeError("Agent provider base URL is not configured.")
    if not model or model == "default":
        raise RuntimeError("Agent provider model is not configured.")

    return AgentModelRuntimeConfig(
        api_format=provider.api_format,
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_ms=current.agent_timeout_ms,
        headers=_to_string_record(provider.headers_json),
        provider_id=str(provider.id),
        provider_name=provider.name,
    )


async def _stream_openai_chat_completion(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    headers = {
        **runtime_config.headers,
        "Authorization": f"Bearer {runtime_config.api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    request_body = {
        "model": runtime_config.model,
        "messages": messages,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=runtime_config.timeout_ms / 1000) as client:
        async with client.stream(
            "POST",
            build_v1_api_url(runtime_config.base_url, "/chat/completions"),
            headers=headers,
            json=request_body,
        ) as response:
            response.raise_for_status()
            async for _event_type, data in _iter_sse_events(response):
                if data == "[DONE]":
                    break

                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue
                text = _extract_stream_delta_text(payload)
                if text:
                    yield text


async def _stream_anthropic_messages(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    system_prompt, anthropic_messages = _split_system_messages(messages)
    headers = {
        **runtime_config.headers,
        "x-api-key": runtime_config.api_key,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    request_body: dict[str, Any] = {
        "model": runtime_config.model,
        "messages": anthropic_messages,
        "max_tokens": 4096,
        "stream": True,
    }
    if system_prompt:
        request_body["system"] = system_prompt

    async with httpx.AsyncClient(timeout=runtime_config.timeout_ms / 1000) as client:
        async with client.stream(
            "POST",
            build_v1_api_url(runtime_config.base_url, "/messages"),
            headers=headers,
            json=request_body,
        ) as response:
            response.raise_for_status()
            async for event_type, data in _iter_sse_events(response):
                if data == "[DONE]":
                    break
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue

                payload_type = payload.get("type") if isinstance(payload, dict) else None
                if event_type == "message_stop" or payload_type == "message_stop":
                    break

                text = _extract_anthropic_stream_delta_text(payload)
                if text:
                    yield text


async def _stream_gemini_generate_content(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    system_prompt, gemini_messages = _split_system_messages(messages)
    headers = {
        **runtime_config.headers,
        "x-goog-api-key": runtime_config.api_key,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    request_body: dict[str, Any] = {
        "contents": [
            {
                "role": _to_gemini_role(message["role"]),
                "parts": [{"text": message["content"]}],
            }
            for message in gemini_messages
        ],
        "generationConfig": {"maxOutputTokens": 4096},
    }
    if system_prompt:
        request_body["systemInstruction"] = {
            "parts": [{"text": system_prompt}],
        }

    emitted_text = ""
    async with httpx.AsyncClient(timeout=runtime_config.timeout_ms / 1000) as client:
        async with client.stream(
            "POST",
            _build_gemini_stream_url(runtime_config.base_url, runtime_config.model),
            headers=headers,
            json=request_body,
        ) as response:
            response.raise_for_status()
            async for _event_type, data in _iter_sse_events(response):
                if data == "[DONE]":
                    break
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue

                text = _extract_gemini_stream_delta_text(payload)
                if not text:
                    continue
                if text.startswith(emitted_text):
                    delta = text[len(emitted_text) :]
                    emitted_text = text
                else:
                    delta = text
                    emitted_text += delta
                if delta:
                    yield delta


async def _stream_provider_chat_completion(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    if runtime_config.api_format in {"openai", "custom"}:
        async for token in _stream_openai_chat_completion(runtime_config, messages=messages):
            yield token
        return
    if runtime_config.api_format == "anthropic":
        async for token in _stream_anthropic_messages(runtime_config, messages=messages):
            yield token
        return
    if runtime_config.api_format == "gemini":
        async for token in _stream_gemini_generate_content(runtime_config, messages=messages):
            yield token
        return
    raise RuntimeError(f"Unsupported agent provider format: {runtime_config.api_format}")


async def get_agent_runtime_status(session: AsyncSession, user_id: str) -> AgentRuntimeStatusDto:
    provider = await get_active_provider_service(session, user_id)
    runtime = AgentRuntimeDetailsDto(
        connected=bool(provider and provider.baseUrl.strip()),
        selectedModel=(provider.model or "default") if provider else "default",
        availableModels=[provider.model] if provider and provider.model else [],
        provider=AgentRuntimeProviderDto(
            id=provider.id,
            name=provider.name,
            apiFormat=provider.apiFormat,
            baseUrl=provider.baseUrl,
            hasApiKey=provider.hasApiKey,
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


async def stream_agent_run_record(
    session: AsyncSession,
    user_id: str,
    payload: CreateAgentRunRequest,
) -> AsyncIterator[dict[str, Any]]:
    runtime = await _resolve_agent_runtime_config(
        session,
        user_id,
        requested_model=payload.model,
    )
    session_item = await _resolve_run_session(session, user_id, payload)
    persona = await find_user_setting(session, user_id)
    user_system_prompt = payload.systemPrompt if payload.systemPrompt is not None else _extract_system_prompt(persona)
    system_prompt = _build_effective_system_prompt(user_system_prompt, rag_enabled=payload.ragEnabled)
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

    yield {
        "type": "metadata",
        "runId": str(run.id),
        "sessionId": str(session_item.id),
        "model": effective_model,
    }

    user_created_at = _timestamp_ms(run.created_at)
    run_messages = _build_initial_run_messages(
        payload.initialMessages,
        input_text=payload.inputText,
        user_created_at=user_created_at,
        system_prompt=system_prompt,
    )
    provider_messages = _build_provider_messages(payload.initialMessages, payload.inputText, system_prompt)
    executed_tool_calls: list[AgentRunToolExecutionDto] = []
    pending_tool_calls: list[AgentRunToolExecutionDto] = []
    assistant_text_chunks: list[str] = []
    timeline: list[TimelineEvent] = []
    final_text = ""
    status = "running"
    error_message: str | None = None
    iteration_count = 0
    raised_error_message: str | None = None

    for iteration in range(MAX_AGENT_ITERATIONS):
        llm_started_at = _iso_timestamp()
        round_tokens: list[str] = []
        try:
            async for token in _stream_provider_chat_completion(runtime, messages=provider_messages):
                round_tokens.append(token)
                yield {
                    "type": "token",
                    "token": token,
                }
        except httpx.HTTPStatusError as exc:
            partial_text = "".join(round_tokens)
            if partial_text:
                assistant_created_at = _timestamp_ms(_now())
                run_messages = _append_assistant_message(run_messages, partial_text, created_at=assistant_created_at)
                assistant_text_chunks.append(partial_text)
                final_text = partial_text
            timeline.extend(
                [
                    TimelineEvent(
                        type="llm_start",
                        timestamp=llm_started_at,
                        data={"model": run.model},
                    ),
                    TimelineEvent(
                        type="interrupted",
                        timestamp=_iso_timestamp(),
                        data={"reason": "provider_http_error", "statusCode": exc.response.status_code},
                    ),
                ]
            )
            status = "failed"
            error_message = f"Agent provider request failed with HTTP {exc.response.status_code}."
            raised_error_message = error_message
            break
        except Exception as exc:
            partial_text = "".join(round_tokens)
            if partial_text:
                assistant_created_at = _timestamp_ms(_now())
                run_messages = _append_assistant_message(run_messages, partial_text, created_at=assistant_created_at)
                assistant_text_chunks.append(partial_text)
                final_text = partial_text
            timeline.extend(
                [
                    TimelineEvent(
                        type="llm_start",
                        timestamp=llm_started_at,
                        data={"model": run.model},
                    ),
                    TimelineEvent(
                        type="interrupted",
                        timestamp=_iso_timestamp(),
                        data={"reason": "provider_error"},
                    ),
                ]
            )
            status = "failed"
            error_message = str(exc)
            raised_error_message = error_message
            break

        assistant_raw_text = "".join(round_tokens)
        parsed_text, parsed_tool_calls = _parse_tool_calls(assistant_raw_text, rag_enabled=payload.ragEnabled)
        assistant_visible_text = parsed_text if parsed_text or not parsed_tool_calls else ""
        assistant_created_at = _timestamp_ms(_now())
        run_messages = _append_assistant_message(run_messages, assistant_visible_text, created_at=assistant_created_at)
        provider_messages.append({"role": "assistant", "content": assistant_visible_text})
        assistant_text_chunks.append(assistant_visible_text or assistant_raw_text)
        final_text = assistant_visible_text
        iteration_count = iteration + 1
        timeline.extend(
            [
                TimelineEvent(
                    type="llm_start",
                    timestamp=llm_started_at,
                    data={"model": run.model},
                ),
                TimelineEvent(
                    type="llm_end",
                    timestamp=_iso_timestamp(),
                    data={"model": run.model, "hasToolCalls": bool(parsed_tool_calls)},
                ),
            ]
        )

        if not parsed_tool_calls:
            status = "completed"
            break

        confirmation_calls = [tool_call for tool_call in parsed_tool_calls if _tool_requires_confirmation(tool_call.name)]
        if confirmation_calls:
            pending_tool_calls = [
                _build_pending_tool_call(tool_call, created_at=assistant_created_at)
                for tool_call in confirmation_calls
            ]
            status = "waiting_confirmation"
            break

        round_executed_tools: list[AgentRunToolExecutionDto] = []
        for tool_call in parsed_tool_calls:
            tool_started_at = _iso_timestamp()
            executed_tool = await _execute_agent_tool_call(session, user_id, tool_call)
            round_executed_tools.append(executed_tool)
            executed_tool_calls.append(executed_tool)
            run_messages = _append_tool_message(
                run_messages,
                executed_tool,
                created_at=executed_tool.createdAt or assistant_created_at,
            )
            timeline.extend(
                [
                    TimelineEvent(
                        type="tool_start",
                        timestamp=tool_started_at,
                        data={"toolName": executed_tool.toolName, "arguments": executed_tool.arguments},
                    ),
                    TimelineEvent(
                        type="tool_end",
                        timestamp=_iso_timestamp(),
                        data={
                            "toolName": executed_tool.toolName,
                            "success": executed_tool.status == "completed",
                        },
                    ),
                ]
            )
            if executed_tool.status != "completed" and error_message is None:
                status = "failed"
                error_message = executed_tool.errorMessage or f"Tool execution failed: {executed_tool.toolName}"

        if status == "failed":
            break

        provider_messages.append(
            {
                "role": "user",
                "content": _build_tool_result_prompt(round_executed_tools),
            }
        )
    else:
        status = "failed"
        error_message = "Agent iteration limit reached."
        timeline.append(
            TimelineEvent(
                type="interrupted",
                timestamp=_iso_timestamp(),
                data={"reason": "iteration_limit"},
            )
        )

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

    if raised_error_message:
        raise RuntimeError(raised_error_message)

    yield {
        "type": "run_completed",
        "run": final_detail.model_dump(),
    }


async def get_agent_run_detail(
    session: AsyncSession,
    user_id: str,
    run_id: str,
) -> AgentRunDetailDto | None:
    run = await find_agent_run_by_id(session, user_id, run_id)
    return _to_agent_run_detail(run) if run else None


async def confirm_agent_tool_record(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    tool_execution_id: str,
) -> AgentRunDetailDto | None:
    run = await find_agent_run_by_id(session, user_id, run_id)
    if not run:
        return None
    if not _validate_confirmation_request(run, tool_execution_id):
        return None
    current_detail = _to_agent_run_detail(run)
    pending_tool = _find_pending_confirmation_tool(current_detail, tool_execution_id)
    if not pending_tool:
        return None

    executed_tool = await _execute_pending_confirmation_tool(session, user_id, pending_tool)
    if executed_tool is not None and executed_tool.status != "completed":
        detail = _build_failed_confirmation_run_detail(
            run,
            current_detail,
            pending_tool,
            "",
            [],
            executed_tool.errorMessage or "Confirmed tool execution failed.",
            executed_tool=executed_tool,
            include_llm_events=False,
        )
        persisted_run = await _persist_run_detail_state(session, user_id, run_id, detail)
        final_run = persisted_run or await find_agent_run_by_id(session, user_id, run_id) or run
        return _bind_detail_to_run(detail, final_run)

    runtime = await _resolve_agent_runtime_config(session, user_id, requested_model=run.model)
    provider_messages = _build_continuation_provider_messages(current_detail, pending_tool, executed_tool)
    assistant_text_chunks: list[str] = []
    try:
        async for token in _stream_provider_chat_completion(runtime, messages=provider_messages):
            assistant_text_chunks.append(token)
    except httpx.HTTPStatusError as exc:
        failure_detail = _build_failed_confirmation_run_detail(
            run,
            current_detail,
            pending_tool,
            "".join(assistant_text_chunks),
            assistant_text_chunks,
            f"Agent provider request failed with HTTP {exc.response.status_code}.",
            executed_tool=executed_tool,
        )
        persisted_run = await _persist_run_detail_state(session, user_id, run_id, failure_detail)
        final_run = persisted_run or await find_agent_run_by_id(session, user_id, run_id) or run
        raise RuntimeError(
            f"Agent provider request failed with HTTP {exc.response.status_code}."
        ) from exc
    except Exception as exc:
        failure_detail = _build_failed_confirmation_run_detail(
            run,
            current_detail,
            pending_tool,
            "".join(assistant_text_chunks),
            assistant_text_chunks,
            str(exc),
            executed_tool=executed_tool,
        )
        await _persist_run_detail_state(session, user_id, run_id, failure_detail)
        raise

    detail = _build_confirmed_run_detail(
        run,
        current_detail,
        pending_tool,
        "".join(assistant_text_chunks),
        assistant_text_chunks,
        executed_tool=executed_tool,
    )
    persisted_run = await _persist_run_detail_state(session, user_id, run_id, detail)
    final_run = persisted_run or await find_agent_run_by_id(session, user_id, run_id) or run
    return _bind_detail_to_run(detail, final_run)


async def stream_confirm_agent_tool_record(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    tool_execution_id: str,
) -> AsyncIterator[dict[str, Any]]:
    run = await find_agent_run_by_id(session, user_id, run_id)
    if not run or not _validate_confirmation_request(run, tool_execution_id):
        raise LookupError("Agent run or tool execution not found.")
    current_detail = _to_agent_run_detail(run)
    pending_tool = _find_pending_confirmation_tool(current_detail, tool_execution_id)
    if not pending_tool:
        raise LookupError("Agent run or tool execution not found.")

    yield {
        "type": "metadata",
        "runId": str(run.id),
        "sessionId": str(run.session_id),
        "model": run.model,
    }

    executed_tool = await _execute_pending_confirmation_tool(session, user_id, pending_tool)
    if executed_tool is not None and executed_tool.status != "completed":
        detail = _build_failed_confirmation_run_detail(
            run,
            current_detail,
            pending_tool,
            "",
            [],
            executed_tool.errorMessage or "Confirmed tool execution failed.",
            executed_tool=executed_tool,
            include_llm_events=False,
        )
        persisted_run = await _persist_run_detail_state(session, user_id, run_id, detail)
        final_run = persisted_run or await find_agent_run_by_id(session, user_id, run_id) or run
        final_detail = _bind_detail_to_run(detail, final_run)
        yield {
            "type": "run_completed",
            "run": final_detail.model_dump(),
        }
        return

    runtime = await _resolve_agent_runtime_config(session, user_id, requested_model=run.model)
    provider_messages = _build_continuation_provider_messages(current_detail, pending_tool, executed_tool)
    assistant_text_chunks: list[str] = []
    try:
        async for token in _stream_provider_chat_completion(runtime, messages=provider_messages):
            assistant_text_chunks.append(token)
            yield {
                "type": "token",
                "token": token,
            }
    except httpx.HTTPStatusError as exc:
        failure_detail = _build_failed_confirmation_run_detail(
            run,
            current_detail,
            pending_tool,
            "".join(assistant_text_chunks),
            assistant_text_chunks,
            f"Agent provider request failed with HTTP {exc.response.status_code}.",
            executed_tool=executed_tool,
        )
        await _persist_run_detail_state(session, user_id, run_id, failure_detail)
        raise RuntimeError(
            f"Agent provider request failed with HTTP {exc.response.status_code}."
        ) from exc
    except Exception as exc:
        failure_detail = _build_failed_confirmation_run_detail(
            run,
            current_detail,
            pending_tool,
            "".join(assistant_text_chunks),
            assistant_text_chunks,
            str(exc),
            executed_tool=executed_tool,
        )
        await _persist_run_detail_state(session, user_id, run_id, failure_detail)
        raise

    detail = _build_confirmed_run_detail(
        run,
        current_detail,
        pending_tool,
        "".join(assistant_text_chunks),
        assistant_text_chunks,
        executed_tool=executed_tool,
    )
    persisted_run = await _persist_run_detail_state(session, user_id, run_id, detail)
    final_run = persisted_run or await find_agent_run_by_id(session, user_id, run_id) or run
    final_detail = _bind_detail_to_run(detail, final_run)
    yield {
        "type": "run_completed",
        "run": final_detail.model_dump(),
    }


async def reject_agent_tool_record(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    tool_execution_id: str,
) -> AgentRunDetailDto | None:
    run = await find_agent_run_by_id(session, user_id, run_id)
    if not run:
        return None
    if not _validate_confirmation_request(run, tool_execution_id):
        return None

    detail = _build_rejected_confirmation_run_detail(run)
    persisted_run = await _persist_run_detail_state(session, user_id, run_id, detail)
    final_run = persisted_run or await find_agent_run_by_id(session, user_id, run_id) or run
    return _bind_detail_to_run(detail, final_run)


async def stream_reject_agent_tool_record(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    tool_execution_id: str,
) -> AsyncIterator[dict[str, Any]]:
    run = await find_agent_run_by_id(session, user_id, run_id)
    if not run or not _validate_confirmation_request(run, tool_execution_id):
        raise LookupError("Agent run or tool execution not found.")

    yield {
        "type": "metadata",
        "runId": str(run.id),
        "sessionId": str(run.session_id),
        "model": run.model,
    }

    detail = _build_rejected_confirmation_run_detail(run)
    persisted_run = await _persist_run_detail_state(session, user_id, run_id, detail)
    final_run = persisted_run or await find_agent_run_by_id(session, user_id, run_id) or run
    final_detail = _bind_detail_to_run(detail, final_run)
    yield {
        "type": "run_completed",
        "run": final_detail.model_dump(),
    }


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
