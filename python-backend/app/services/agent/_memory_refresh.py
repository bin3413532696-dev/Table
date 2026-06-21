from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.repositories.agent import find_agent_session_by_id, list_runs_for_session, update_agent_session
from app.services.agent._constants import _now
from app.services.agent._long_term_memory import consolidate_agent_memory_events
from app.services.agent._memory import (
    _build_memory_generation_messages,
    _parse_memory_model_output,
    _select_runs_for_memory_refresh,
    _should_refresh_session_memory,
)
from app.services.agent._runtime_support import _stream_provider_chat_completion, resolve_runtime_config_for_user

logger = logging.getLogger("table-python-backend.agent.memory")


async def _collect_completion_text(
    runtime: Any,
    *,
    messages: list[dict[str, str]],
) -> str:
    parts: list[str] = []
    async for token in _stream_provider_chat_completion(runtime, messages=messages):
        parts.append(token)
    return "".join(parts).strip()


async def _refresh_session_memory_record(
    session: AsyncSession,
    user_id: str,
    session_id: str,
) -> None:
    session_item = await find_agent_session_by_id(session, user_id, session_id)
    if not session_item:
        return

    runs = await list_runs_for_session(session, user_id, session_id)
    if not _should_refresh_session_memory(session_item, runs):
        if session_item.memory_status == "pending":
            await update_agent_session(session, user_id, session_id, memory_status="idle")
        return

    await update_agent_session(session, user_id, session_id, memory_status="processing")
    refreshed_session = await find_agent_session_by_id(session, user_id, session_id)
    if not refreshed_session:
        return

    source_runs, eligible_run_count = _select_runs_for_memory_refresh(refreshed_session, runs)
    memory_prompt_messages = _build_memory_generation_messages(refreshed_session, source_runs)
    requested_model = source_runs[-1].model if source_runs else "default"

    try:
        runtime = await resolve_runtime_config_for_user(session, user_id, requested_model)
        completion_text = await _collect_completion_text(runtime, messages=memory_prompt_messages)
        memory = _parse_memory_model_output(completion_text)
        await update_agent_session(
            session,
            user_id,
            session_id,
            memory_summary=memory.summary,
            memory_preferences_json=list(memory.preferences),
            memory_facts_json=list(memory.facts),
            memory_goals_json=[goal.model_dump() for goal in memory.goals],
            memory_todos_json=[todo.model_dump() for todo in memory.todos],
            memory_rules_json=list(memory.rules),
            memory_status="ready",
            memory_updated_at=_now(),
            memory_run_count=eligible_run_count,
        )
    except Exception:
        logger.exception("Failed to refresh session memory", extra={"session_id": session_id, "user_id": user_id})
        await update_agent_session(
            session,
            user_id,
            session_id,
            memory_status="failed",
        )


async def _refresh_session_memory_task(user_id: str, session_id: str) -> None:
    async with SessionLocal() as background_session:
        await consolidate_agent_memory_events(background_session, user_id, session_id=session_id)


async def maybe_schedule_session_memory_refresh(
    session: AsyncSession,
    user_id: str,
    session_id: str,
) -> None:
    try:
        session_item = await find_agent_session_by_id(session, user_id, session_id)
        if not session_item:
            return
        await update_agent_session(session, user_id, session_id, memory_status="pending")
        asyncio.create_task(_refresh_session_memory_task(user_id, session_id))
    except Exception:
        logger.debug(
            "Skipping session memory refresh scheduling",
            exc_info=True,
            extra={"session_id": session_id, "user_id": user_id},
        )
