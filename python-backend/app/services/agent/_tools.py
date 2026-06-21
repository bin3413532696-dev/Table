from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.schemas.agent import AgentRunToolExecutionDto
import app.services.agent._tool_prompting as agent_tool_prompting
from app.services.agent._constants import AgentToolCall, _now, _string_or_none, _timestamp_ms
from app.services.agent.registry import AgentToolExecutionContext, get_tool_definition
from app.services.agent.tools import ensure_builtin_tool_definitions_registered

ensure_builtin_tool_definitions_registered()

_append_assistant_message = agent_tool_prompting._append_assistant_message
_append_tool_message = agent_tool_prompting._append_tool_message
_build_effective_system_prompt = agent_tool_prompting._build_effective_system_prompt
_build_tool_result_prompt = agent_tool_prompting._build_tool_result_prompt
_parse_tool_calls = agent_tool_prompting._parse_tool_calls
_supported_agent_tool_names = agent_tool_prompting._supported_agent_tool_names
_tool_requires_confirmation = agent_tool_prompting._tool_requires_confirmation


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
