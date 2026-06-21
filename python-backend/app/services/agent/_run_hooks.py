from __future__ import annotations

from typing import Any

from app.schemas.agent import AgentRunDetailDto


async def fire_run_end_event(
    hooks: Any,
    *,
    run_id: str,
    session_id: str,
    user_id: str,
    detail: AgentRunDetailDto,
    confirmation: bool = False,
) -> None:
    await hooks.fire(
        "on_run_end",
        run_id=run_id,
        session_id=session_id,
        user_id=user_id,
        status=detail.status,
        final_text=detail.finalText,
        confirmation=confirmation,
    )
