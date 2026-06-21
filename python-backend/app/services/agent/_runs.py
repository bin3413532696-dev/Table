from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import VersionConflictError
from app.db.models import AgentSession
from app.repositories.agent import (
    create_agent_session,
    delete_agent_run,
    find_agent_run_by_id,
    find_agent_session_by_id,
    list_agent_runs,
    update_agent_run,
    update_agent_session,
)
from app.schemas.agent import (
    AgentDeleteResponse,
    AgentRunDetailDto,
    AgentRunDto,
    AgentRunListResponse,
    CreateAgentRunRequest,
    ListAgentRunsQuery,
    UpdateAgentRunRequest,
)
from app.services.agent._constants import ACTIVE_AGENT_RUN_STATUSES, DEFAULT_SESSION_TITLE, _generate_session_title
from app.services.agent._state import _to_agent_run_detail, _to_agent_run_dto


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


async def resolve_run_session(
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
    from app.services.agent._execution import stream_agent_run_record

    final_run_payload: dict[str, Any] | None = None
    async for event in stream_agent_run_record(session, user_id, payload):
        if event.get("type") == "run_completed":
            final_run_payload = event.get("run") if isinstance(event.get("run"), dict) else None
    if not final_run_payload:
        raise RuntimeError("Agent run did not complete.")
    return AgentRunDetailDto.model_validate(final_run_payload)


async def get_agent_run_detail(
    session: AsyncSession,
    user_id: str,
    run_id: str,
) -> AgentRunDetailDto | None:
    run = await find_agent_run_by_id(session, user_id, run_id)
    return _to_agent_run_detail(run) if run else None


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
