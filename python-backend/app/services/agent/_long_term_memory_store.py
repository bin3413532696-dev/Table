from __future__ import annotations

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.agent import list_runs_for_session, update_agent_session
from app.repositories.agent_memory import (
    create_memory_event,
    delete_memory_blocks_for_scope,
    delete_memory_records_for_scope,
    get_memory_block,
    list_memory_records_for_scope,
    list_pending_memory_events,
    mark_memory_event_processed,
    upsert_memory_block,
    upsert_memory_record,
)
from app.repositories.knowledge_corpora import find_primary_corpus_for_document
from app.schemas.agent import AgentRunDetailDto
from app.services.agent._constants import _now
from app.services.agent._long_term_memory_rules import (
    _build_session_summary,
    _collect_user_messages,
    _extract_corpus_document_ids,
    _extract_goal_memory,
    _extract_preference_memory,
    _extract_rule_memory,
    _merge_memory_lines,
    _normalize_line,
)


async def append_agent_memory_event(
    session: AsyncSession,
    user_id: str,
    *,
    session_id: str,
    run_id: str,
    detail: AgentRunDetailDto,
) -> None:
    try:
        await create_memory_event(
            session,
            user_id,
            session_id=session_id,
            run_id=run_id,
            event_type="run_completed",
            payload={
                "status": detail.status,
                "finalText": detail.finalText,
                "messages": [message.model_dump() for message in detail.messages],
                "executedToolCalls": [tool.model_dump() for tool in detail.executedToolCalls],
                "pendingToolCalls": [tool.model_dump() for tool in detail.pendingToolCalls],
                "timeline": [event.model_dump() for event in detail.timeline],
            },
        )
    except AttributeError:
        if not hasattr(session, "add"):
            return
        raise


async def rebuild_session_memory_cache(
    session: AsyncSession,
    user_id: str,
    *,
    session_id: str,
) -> None:
    session_records = await list_memory_records_for_scope(
        session, user_id, scope_type="session", scope_id=session_id
    )
    personal_records = await list_memory_records_for_scope(
        session,
        user_id,
        scope_type="user",
        scope_id=user_id,
    )

    preferences = [
        record.content
        for record in personal_records
        if record.memory_slot == "preference" and record.content
    ]
    rules = [record.content for record in personal_records if record.memory_slot == "rule" and record.content]
    goals = [record.content for record in session_records if record.memory_slot == "goal" and record.content]
    facts = [record.content for record in session_records if record.memory_slot == "episode" and record.content]
    summary_record = next((record for record in session_records if record.memory_slot == "profile"), None)

    await update_agent_session(
        session,
        user_id,
        session_id,
        memory_summary=summary_record.summary if summary_record else "",
        memory_preferences_json=preferences[:8],
        memory_facts_json=facts[:8],
        memory_goals_json=[{"title": value, "status": "active"} for value in goals[:6]],
        memory_todos_json=[],
        memory_rules_json=rules[:8],
        memory_status="ready",
        memory_updated_at=_now(),
        memory_run_count=max(len(await list_runs_for_session(session, user_id, session_id)), 0),
    )


async def clear_long_term_memory_for_session(
    session: AsyncSession,
    user_id: str,
    *,
    session_id: str,
) -> None:
    await delete_memory_records_for_scope(session, user_id, scope_type="session", scope_id=session_id)
    await delete_memory_blocks_for_scope(session, user_id, scope_type="session", scope_id=session_id)


async def build_long_term_memory_context(
    session: AsyncSession,
    user_id: str,
    *,
    session_id: str,
) -> str:
    blocks: list[str] = []
    try:
        identity_block = await get_memory_block(
            session,
            user_id,
            block_type="identity",
            scope_type="user",
            scope_id=user_id,
        )
    except AttributeError:
        if not hasattr(session, "scalar"):
            return ""
        raise
    if identity_block and identity_block.content.strip():
        blocks.append(f"【个人长期记忆】\n{identity_block.content.strip()}")

    task_block = await get_memory_block(
        session,
        user_id,
        block_type="task",
        scope_type="session",
        scope_id=session_id,
    )
    if task_block and task_block.content.strip():
        blocks.append(f"【当前任务记忆】\n{task_block.content.strip()}")

    return "\n\n".join(blocks).strip()


async def resolve_session_corpus_id(
    session: AsyncSession,
    user_id: str,
    *,
    session_id: str,
) -> str | None:
    try:
        corpus_block = await get_memory_block(
            session,
            user_id,
            block_type="corpus",
            scope_type="session",
            scope_id=session_id,
        )
    except AttributeError:
        if not hasattr(session, "scalar"):
            return None
        raise
    if corpus_block and corpus_block.content.strip():
        match = re.search(r"corpus_id=([0-9a-fA-F-]{36})", corpus_block.content)
        if match:
            return match.group(1)

    session_records = await list_memory_records_for_scope(session, user_id, scope_type="session", scope_id=session_id)
    for record in session_records:
        source_document_id = getattr(record, "source_document_id", None)
        if source_document_id:
            link = await find_primary_corpus_for_document(
                session,
                user_id,
                document_id=str(source_document_id),
            )
            if link:
                return str(link.corpus_id)
    return None


async def consolidate_agent_memory_events(
    session: AsyncSession,
    user_id: str,
    *,
    session_id: str,
) -> None:
    pending_events = await list_pending_memory_events(session, user_id, session_id=session_id)
    for event in pending_events:
        payload = event.payload_json if isinstance(event.payload_json, dict) else {}
        try:
            detail = AgentRunDetailDto.model_validate(
                {
                    "id": str(event.run_id),
                    "sessionId": str(event.session_id),
                    "status": payload.get("status") or "completed",
                    "inputText": "",
                    "model": "default",
                    "createdAt": 0,
                    "updatedAt": 0,
                    "version": 1,
                    "messages": payload.get("messages") or [],
                    "executedToolCalls": payload.get("executedToolCalls") or [],
                    "pendingToolCalls": payload.get("pendingToolCalls") or [],
                    "requiresConfirmation": bool(payload.get("pendingToolCalls")),
                    "finalText": payload.get("finalText") or "",
                    "error": None,
                    "iterationCount": 1,
                    "assistantTextChunks": [],
                    "timeline": payload.get("timeline") or [],
                }
            )
        except Exception:
            await mark_memory_event_processed(session, user_id, str(event.id), status="discarded")
            continue

        messages = _collect_user_messages(detail)
        preferences = _extract_preference_memory(messages)
        rules = _extract_rule_memory(messages)
        goals = _extract_goal_memory(messages)
        corpus_document_ids = _extract_corpus_document_ids(detail)
        primary_corpus_id: str | None = None
        if corpus_document_ids:
            primary_link = await find_primary_corpus_for_document(
                session,
                user_id,
                document_id=corpus_document_ids[0],
            )
            if primary_link:
                primary_corpus_id = str(primary_link.corpus_id)
        session_summary = _build_session_summary(detail, goals, preferences, rules)

        for preference in preferences:
            await upsert_memory_record(
                session,
                user_id,
                scope_type="user",
                scope_id=user_id,
                memory_kind="semantic",
                memory_slot="preference",
                title="个人偏好",
                content=preference,
                summary=preference,
                confidence=0.9,
                salience=0.8,
                source_run_id=str(event.run_id),
                source_document_id=None,
                evidence={"eventId": str(event.id)},
            )

        for rule in rules:
            await upsert_memory_record(
                session,
                user_id,
                scope_type="user",
                scope_id=user_id,
                memory_kind="semantic",
                memory_slot="rule",
                title="个人规则",
                content=rule,
                summary=rule,
                confidence=0.9,
                salience=0.9,
                source_run_id=str(event.run_id),
                source_document_id=None,
                evidence={"eventId": str(event.id)},
            )

        for goal in goals:
            await upsert_memory_record(
                session,
                user_id,
                scope_type="session",
                scope_id=str(event.session_id),
                memory_kind="episodic",
                memory_slot="goal",
                title="当前目标",
                content=goal,
                summary=goal,
                confidence=0.75,
                salience=0.7,
                source_run_id=str(event.run_id),
                source_document_id=None,
                evidence={"eventId": str(event.id)},
            )

        if session_summary:
            await upsert_memory_record(
                session,
                user_id,
                scope_type="session",
                scope_id=str(event.session_id),
                memory_kind="episodic",
                memory_slot="profile",
                title="会话概况",
                content=session_summary,
                summary=session_summary,
                confidence=0.8,
                salience=0.8,
                source_run_id=str(event.run_id),
                source_document_id=corpus_document_ids[0] if corpus_document_ids else None,
                evidence={"eventId": str(event.id), "documentIds": corpus_document_ids},
            )

        if detail.finalText.strip():
            episode_text = _normalize_line(detail.finalText, limit=220)
            if episode_text:
                await upsert_memory_record(
                    session,
                    user_id,
                    scope_type="session",
                    scope_id=str(event.session_id),
                    memory_kind="episodic",
                    memory_slot="episode",
                    title="最近产出",
                    content=episode_text,
                    summary=episode_text,
                    confidence=0.7,
                    salience=0.65,
                    source_run_id=str(event.run_id),
                    source_document_id=corpus_document_ids[0] if corpus_document_ids else None,
                    evidence={"eventId": str(event.id)},
                )

        identity_lines = _merge_memory_lines(preferences[:3], rules[:3], limit=6)
        if identity_lines:
            await upsert_memory_block(
                session,
                user_id,
                block_type="identity",
                scope_type="user",
                scope_id=user_id,
                content="\n".join(identity_lines),
            )

        if goals or session_summary:
            task_lines = _merge_memory_lines(goals[:3], [session_summary] if session_summary else [], limit=4)
            await upsert_memory_block(
                session,
                user_id,
                block_type="task",
                scope_type="session",
                scope_id=str(event.session_id),
                content="\n".join(task_lines),
            )

        if primary_corpus_id:
            await upsert_memory_block(
                session,
                user_id,
                block_type="corpus",
                scope_type="session",
                scope_id=str(event.session_id),
                content=f"corpus_id={primary_corpus_id}\n最近命中文档：{', '.join(corpus_document_ids[:3])}",
            )

        await mark_memory_event_processed(session, user_id, str(event.id), status="processed")

    await rebuild_session_memory_cache(session, user_id, session_id=session_id)
