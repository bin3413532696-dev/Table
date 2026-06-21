from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.agent import AgentRunDetailDto
from app.services.agent._memory_refresh import maybe_schedule_session_memory_refresh


async def schedule_memory_refresh_for_detail(
    session: AsyncSession,
    user_id: str,
    session_id: str,
    detail: AgentRunDetailDto,
    *,
    allowed_statuses: set[str],
) -> None:
    if detail.status in allowed_statuses:
        await maybe_schedule_session_memory_refresh(session, user_id, session_id)


__all__ = ["schedule_memory_refresh_for_detail"]
