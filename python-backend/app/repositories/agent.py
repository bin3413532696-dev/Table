from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from uuid import UUID, uuid4

from app.db.models import AgentRun, AgentSession, UserSetting
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

_UNSET = object()


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def list_agent_sessions(
    session: AsyncSession,
    user_id: str,
    *,
    limit: int,
    offset: int,
) -> tuple[list[AgentSession], int]:
    items = list(
        await session.scalars(
            select(AgentSession)
            .where(AgentSession.user_id == UUID(user_id))
            .order_by(AgentSession.updated_at.desc(), AgentSession.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    total = int(
        await session.scalar(
            select(func.count()).select_from(AgentSession).where(AgentSession.user_id == UUID(user_id))
        )
        or 0
    )
    return items, total


async def find_agent_session_by_id(
    session: AsyncSession,
    user_id: str,
    session_id: str,
) -> AgentSession | None:
    return await session.scalar(
        select(AgentSession).where(
            AgentSession.id == UUID(session_id),
            AgentSession.user_id == UUID(user_id),
        )
    )


async def list_runs_for_session_ids(
    session: AsyncSession,
    user_id: str,
    session_ids: list[UUID],
) -> dict[UUID, list[AgentRun]]:
    if not session_ids:
        return {}

    runs = list(
        await session.scalars(
            select(AgentRun)
            .where(
                AgentRun.user_id == UUID(user_id),
                AgentRun.session_id.in_(session_ids),
            )
            .order_by(AgentRun.created_at.asc(), AgentRun.updated_at.asc())
        )
    )
    grouped: dict[UUID, list[AgentRun]] = defaultdict(list)
    for run in runs:
        grouped[run.session_id].append(run)
    return grouped


async def list_runs_for_session(
    session: AsyncSession,
    user_id: str,
    session_id: str,
) -> list[AgentRun]:
    return list(
        await session.scalars(
            select(AgentRun)
            .where(
                AgentRun.user_id == UUID(user_id),
                AgentRun.session_id == UUID(session_id),
            )
            .order_by(AgentRun.created_at.asc(), AgentRun.updated_at.asc())
        )
    )


async def create_agent_session(
    session: AsyncSession,
    user_id: str,
    title: str,
) -> AgentSession:
    current_time = _now()
    item = AgentSession(
        id=uuid4(),
        user_id=UUID(user_id),
        title=title,
        created_at=current_time,
        updated_at=current_time,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


async def update_agent_session(
    session: AsyncSession,
    user_id: str,
    session_id: str,
    *,
    title: str | None = None,
    memory_summary: str | None | object = _UNSET,
    memory_preferences_json: list[str] | None | object = _UNSET,
    memory_facts_json: list[str] | None | object = _UNSET,
    memory_goals_json: list[dict] | None | object = _UNSET,
    memory_todos_json: list[dict] | None | object = _UNSET,
    memory_rules_json: list[str] | None | object = _UNSET,
    memory_status: str | None | object = _UNSET,
    memory_updated_at: datetime | None | object = _UNSET,
    memory_disabled: bool | object = _UNSET,
    memory_run_count: int | None | object = _UNSET,
) -> AgentSession | None:
    item = await find_agent_session_by_id(session, user_id, session_id)
    if not item:
        return None

    if title is not None:
        item.title = title
    if memory_summary is not _UNSET:
        item.memory_summary = memory_summary or ""
    if memory_preferences_json is not _UNSET:
        item.memory_preferences_json = list(memory_preferences_json or [])
    if memory_facts_json is not _UNSET:
        item.memory_facts_json = list(memory_facts_json or [])
    if memory_goals_json is not _UNSET:
        item.memory_goals_json = list(memory_goals_json or [])
    if memory_todos_json is not _UNSET:
        item.memory_todos_json = list(memory_todos_json or [])
    if memory_rules_json is not _UNSET:
        item.memory_rules_json = list(memory_rules_json or [])
    if memory_status is not _UNSET:
        item.memory_status = memory_status or "idle"
    if memory_updated_at is not _UNSET:
        item.memory_updated_at = memory_updated_at
    if memory_disabled is not _UNSET:
        item.memory_disabled = bool(memory_disabled)
    if memory_run_count is not _UNSET:
        item.memory_run_count = int(memory_run_count or 0)
    item.updated_at = _now()
    await session.commit()
    await session.refresh(item)
    return item


async def delete_agent_session(
    session: AsyncSession,
    user_id: str,
    session_id: str,
) -> AgentSession | None:
    item = await find_agent_session_by_id(session, user_id, session_id)
    if not item:
        return None

    await session.execute(delete(AgentSession).where(AgentSession.id == UUID(session_id)))
    await session.commit()
    return item


async def list_agent_runs(
    session: AsyncSession,
    user_id: str,
    *,
    limit: int,
    offset: int,
    session_id: str | None = None,
    status: str | None = None,
) -> tuple[list[AgentRun], int]:
    filters = [AgentRun.user_id == UUID(user_id)]
    if session_id:
        filters.append(AgentRun.session_id == UUID(session_id))
    if status:
        filters.append(AgentRun.status == status)

    items = list(
        await session.scalars(
            select(AgentRun)
            .where(*filters)
            .order_by(AgentRun.created_at.desc(), AgentRun.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    total = int(
        await session.scalar(select(func.count()).select_from(AgentRun).where(*filters))
        or 0
    )
    return items, total


async def find_agent_run_by_id(
    session: AsyncSession,
    user_id: str,
    run_id: str,
) -> AgentRun | None:
    return await session.scalar(
        select(AgentRun).where(
            AgentRun.id == UUID(run_id),
            AgentRun.user_id == UUID(user_id),
        )
    )


async def create_agent_run(
    session: AsyncSession,
    user_id: str,
    *,
    session_id: str,
    input_text: str,
    model: str,
    status: str = "pending",
) -> AgentRun:
    current_time = _now()
    item = AgentRun(
        id=uuid4(),
        user_id=UUID(user_id),
        session_id=UUID(session_id),
        status=status,
        input_text=input_text,
        model=model,
        created_at=current_time,
        updated_at=current_time,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


async def update_agent_run(
    session: AsyncSession,
    user_id: str,
    run_id: str,
    *,
    status: str | None = None,
    messages_json: list[dict] | None = None,
    executed_tool_calls_json: list[dict] | None = None,
    pending_tool_calls_json: list[dict] | None = None,
    assistant_text_chunks_json: list[str] | None = None,
    timeline_json: list[dict] | None = None,
    final_text: str | None = None,
    error_text: str | None | object = _UNSET,
    iteration_count: int | None = None,
    requires_confirmation: bool | None = None,
    expected_version: int | None = None,
) -> AgentRun | None:
    values: dict[str, object] = {
        "updated_at": _now(),
        "version": AgentRun.version + 1,
    }
    if status is not None:
        values["status"] = status
    if messages_json is not None:
        values["messages_json"] = messages_json
    if executed_tool_calls_json is not None:
        values["executed_tool_calls_json"] = executed_tool_calls_json
    if pending_tool_calls_json is not None:
        values["pending_tool_calls_json"] = pending_tool_calls_json
    if assistant_text_chunks_json is not None:
        values["assistant_text_chunks_json"] = assistant_text_chunks_json
    if timeline_json is not None:
        values["timeline_json"] = timeline_json
    if final_text is not None:
        values["final_text"] = final_text
    if error_text is not _UNSET:
        values["error_text"] = error_text
    if iteration_count is not None:
        values["iteration_count"] = iteration_count
    if requires_confirmation is not None:
        values["requires_confirmation"] = requires_confirmation

    statement = update(AgentRun).where(
        AgentRun.id == UUID(run_id),
        AgentRun.user_id == UUID(user_id),
    )
    if expected_version is not None:
        statement = statement.where(AgentRun.version == expected_version)

    result = await session.execute(statement.values(**values).returning(AgentRun))
    item = result.scalar_one_or_none()
    if not item:
        await session.rollback()
        return None

    await session.commit()
    return item


async def delete_agent_run(
    session: AsyncSession,
    user_id: str,
    run_id: str,
) -> AgentRun | None:
    item = await find_agent_run_by_id(session, user_id, run_id)
    if not item:
        return None

    await session.execute(delete(AgentRun).where(AgentRun.id == UUID(run_id)))
    await session.commit()
    return item


async def find_user_setting(session: AsyncSession, user_id: str) -> UserSetting | None:
    return await session.scalar(select(UserSetting).where(UserSetting.user_id == UUID(user_id)))


async def update_agent_persona(
    session: AsyncSession,
    user_id: str,
    system_prompt: str,
) -> UserSetting:
    item = await find_user_setting(session, user_id)
    if not item:
        item = UserSetting(
            id=uuid4(),
            user_id=UUID(user_id),
            agent_preferences_json={"systemPrompt": system_prompt},
        )
        session.add(item)
    else:
        item.agent_preferences_json = {"systemPrompt": system_prompt}
        item.updated_at = _now()

    await session.commit()
    await session.refresh(item)
    return item
