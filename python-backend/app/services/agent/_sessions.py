from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.agent import (
    create_agent_session,
    delete_agent_session,
    find_agent_session_by_id,
    find_user_setting,
    list_agent_sessions,
    list_runs_for_session,
    list_runs_for_session_ids,
    update_agent_persona,
    update_agent_session,
)
from app.repositories.providers import find_active_provider_for_user
from app.schemas.agent import (
    AgentCapabilitiesDto,
    AgentDeleteResponse,
    AgentPersonaDto,
    AgentRuntimeDetailsDto,
    AgentRuntimeProviderDto,
    AgentRuntimeStatusDto,
    AgentSessionDetailDto,
    AgentSessionDto,
    AgentSessionMemoryDto,
    CreateAgentSessionRequest,
    ListAgentSessionsQuery,
    UpdateAgentSessionMemorySettingsRequest,
    UpdateAgentSessionRequest,
)
from app.services.agent._long_term_memory import clear_long_term_memory_for_session
from app.services.agent._memory import _to_agent_session_memory_dto
from app.services.agent._state import (
    _aggregate_session_messages,
    _extract_system_prompt,
    _to_agent_session_detail,
    _to_agent_session_dto,
)
from app.services.agent.registry import list_provider_capabilities, list_tool_capabilities


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
    await clear_long_term_memory_for_session(session, user_id, session_id=session_id)
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
