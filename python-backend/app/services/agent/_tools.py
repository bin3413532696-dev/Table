from __future__ import annotations

from datetime import datetime
import json
import re
from typing import Any
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.repositories.finance import create_finance_record as create_finance_record_repo
from app.repositories.finance import list_finance_records as list_finance_records_repo
from app.repositories.knowledge import normalize_tags as normalize_note_tags
from app.repositories.knowledge import search_notes as search_notes_repo
from app.repositories.knowledge_rag import get_chunk_by_id as get_rag_chunk_by_id
from app.repositories.tasks import (
    create_task as create_task_repo,
    delete_task as delete_task_repo,
    find_task_by_id,
    update_task as update_task_repo,
)
from app.repositories.tasks import list_tasks as list_tasks_repo
from app.schemas.agent import AgentInitialMessage, AgentRunMessageDto, AgentRunToolExecutionDto
from app.schemas.finance import CreateFinanceRecordRequest
from app.schemas.knowledge import NoteSearchQuery
from app.schemas.knowledge_rag import HybridSearchRequest
from app.schemas.task import CreateTaskRequest, UpdateTaskRequest
from app.services.finance import to_finance_record_response
from app.services.knowledge_rag import build_search_context, search_service, search_with_context_service
from app.services.tasks import to_task_response
from app.services.agent.registry import (
    AgentToolAvailabilityContext,
    AgentToolExecutionContext,
    get_tool_definition,
    list_tool_definitions,
)
from app.services.agent.tools import ensure_builtin_tool_definitions_registered

from app.services.agent._constants import (
    JSON_BLOCK_REGEX,
    TOOL_BLOCK_REGEX,
    AgentToolCall,
    _normalize_task_priority,
    _now,
    _string_or_none,
    _timestamp_ms,
)

ensure_builtin_tool_definitions_registered()
PROVIDER_TOOL_ARTIFACT_REGEX = re.compile(r"</?[\w.-]+:tool_call>\s*", re.IGNORECASE)


def _supported_agent_tool_names(*, rag_enabled: bool) -> list[str]:
    return [definition.name for definition in list_tool_definitions(rag_enabled=rag_enabled)]


def _tool_requires_confirmation(tool_name: str) -> bool:
    definition = get_tool_definition(tool_name)
    return bool(definition and definition.requires_confirmation)


def _build_effective_system_prompt(
    user_prompt: str,
    *,
    rag_enabled: bool,
    session_memory: str = "",
) -> str:
    tool_lines = [definition.prompt_signature for definition in list_tool_definitions(rag_enabled=rag_enabled)]
    tool_list = "\n".join(f"- {line}" for line in tool_lines)
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
            "9. 如果知识库工具返回未找到相关内容、没有来源或置信度很低，只能明确说明知识库未命中，不得把你自己的先验知识当作知识库事实补答。\n"
        )
    sections: list[str] = []
    if user_prompt.strip():
        sections.append(user_prompt.strip())
    if session_memory.strip():
        sections.append(session_memory.strip())
    sections.append(base_prompt)
    return "\n\n".join(section for section in sections if section)


def _strip_provider_tool_artifacts(content: str) -> str:
    stripped = PROVIDER_TOOL_ARTIFACT_REGEX.sub("", content)
    stripped = re.sub(r"\n{3,}", "\n\n", stripped)
    return stripped.strip()


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
    return _strip_provider_tool_artifacts(text_content), unique_tool_calls


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
    definition = get_tool_definition(tool_call.name)
    if not definition:
        return AgentRunToolExecutionDto(
            id=tool_call.id,
            toolName=tool_call.name,
            arguments=tool_call.arguments,
            status="failed",
            requiresConfirmation=False,
            errorMessage=f"Unsupported agent tool: {tool_call.name}",
            createdAt=created_at,
        )

    try:
        result = await definition.execute(
            AgentToolExecutionContext(session=session, user_id=user_id, settings=current),
            tool_call.arguments,
        )
    except Exception as exc:
        return AgentRunToolExecutionDto(
            id=tool_call.id,
            toolName=tool_call.name,
            arguments=tool_call.arguments,
            status="failed",
            requiresConfirmation=definition.requires_confirmation,
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
        requiresConfirmation=definition.requires_confirmation,
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
        "以下是已经真实执行完成的工具结果。你必须只基于这些真实结果继续回答用户问题。\n"
        "1. 如果信息已经足够，直接给出最终答案，不要再次调用工具。\n"
        "2. 只有当结果明显不足以回答用户问题时，才继续调用一个额外工具。\n"
        "3. 不要输出任何 XML、HTML 或 provider 工具标记，例如 <...tool_call>。\n"
        "4. 如果结果中已经包含来源信息，请直接用自然语言在答案末尾标注来源。\n\n"
        "5. 如果结果明确显示未找到相关内容或没有任何来源，只能如实说明未命中，不要补充你的先验知识。\n\n"
        f"{joined_blocks}"
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


async def _execute_pending_confirmation_tool(
    session: AsyncSession,
    user_id: str,
    pending_tool: AgentRunToolExecutionDto,
) -> AgentRunToolExecutionDto | None:
    if pending_tool.toolName == "pending_confirmation":
        return None

    created_at = _timestamp_ms(_now())
    definition = get_tool_definition(pending_tool.toolName)
    current = get_settings()
    if not definition or not definition.execute_after_confirmation:
        return AgentRunToolExecutionDto(
            id=pending_tool.id,
            toolName=pending_tool.toolName,
            arguments=pending_tool.arguments,
            status="failed",
            requiresConfirmation=False,
            errorMessage=f"Unsupported confirmed agent tool: {pending_tool.toolName}",
            createdAt=created_at,
        )
    try:
        result = await definition.execute_after_confirmation(
            AgentToolExecutionContext(session=session, user_id=user_id, settings=current),
            pending_tool.arguments,
        )
        if isinstance(result, str):
            result_payload: dict[str, object] = {"textContent": result}
        elif isinstance(result, dict):
            result_payload = {key: value for key, value in result.items() if isinstance(key, str)}
        else:
            result_payload = {"value": result}
        return AgentRunToolExecutionDto(
            id=pending_tool.id,
            toolName=pending_tool.toolName,
            arguments=pending_tool.arguments,
            status="completed",
            requiresConfirmation=False,
            result=result_payload,
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
