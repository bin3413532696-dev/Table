from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import TypeVar

from app.schemas.agent import AgentRunDetailDto

TaskResultT = TypeVar("TaskResultT")


async def emit_noop_event(_event: dict[str, object]) -> None:
    return None


async def drain_background_events(
    task: asyncio.Task[TaskResultT],
    queue: asyncio.Queue[dict[str, object]],
) -> AsyncIterator[dict[str, object]]:
    while not task.done() or not queue.empty():
        try:
            event = await asyncio.wait_for(queue.get(), timeout=0.05)
        except TimeoutError:
            continue
        yield event


def build_metadata_event(*, run_id: str, session_id: str, model: str) -> dict[str, object]:
    return {
        "type": "metadata",
        "runId": run_id,
        "sessionId": session_id,
        "model": model,
    }


def build_run_completed_event(detail: AgentRunDetailDto) -> dict[str, object]:
    return {
        "type": "run_completed",
        "run": detail.model_dump(),
    }
