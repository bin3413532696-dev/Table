from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.schemas.agent import AgentRunDetailDto
from app.services.agent._long_term_memory import (
    _extract_preference_memory,
    _extract_goal_memory,
    _extract_rule_memory,
    append_agent_memory_event,
    build_long_term_memory_context,
    clear_long_term_memory_for_session,
    consolidate_agent_memory_events,
)


def _build_detail() -> AgentRunDetailDto:
    return AgentRunDetailDto.model_validate(
        {
            "id": str(uuid.uuid4()),
            "sessionId": str(uuid.uuid4()),
            "status": "completed",
            "inputText": "以后默认中文回答，并且不要自动修改财务记录",
            "model": "gpt-4o-mini",
            "createdAt": 1,
            "updatedAt": 2,
            "version": 1,
            "messages": [
                {
                    "id": "u1",
                    "role": "user",
                    "content": "以后默认中文回答，并且不要自动修改财务记录",
                    "createdAt": 1,
                },
                {
                    "id": "a1",
                    "role": "assistant",
                    "content": "好的，我会用中文，并避免自动改财务记录。",
                    "createdAt": 2,
                },
            ],
            "executedToolCalls": [],
            "pendingToolCalls": [],
            "requiresConfirmation": False,
            "finalText": "好的，我会用中文，并避免自动改财务记录。",
            "error": None,
            "iterationCount": 1,
            "assistantTextChunks": ["好的，我会用中文，并避免自动改财务记录。"],
            "timeline": [],
        }
    )


def test_extractors_identify_preference_and_rule_lines() -> None:
    messages = ["以后默认中文回答", "不要自动修改财务记录", "这次简单说一下"]

    assert _extract_preference_memory(messages) == ["以后默认中文回答"]
    assert _extract_rule_memory(messages) == ["不要自动修改财务记录"]


def test_extractors_split_compound_instruction_into_distinct_memories() -> None:
    messages = ["以后默认中文回答，并且不要自动修改财务记录，继续讲解热力学第二定律"]

    assert _extract_preference_memory(messages) == ["以后默认中文回答"]
    assert _extract_rule_memory(messages) == ["不要自动修改财务记录"]
    assert _extract_goal_memory(messages) == ["继续讲解热力学第二定律"]


@pytest.mark.asyncio
async def test_append_agent_memory_event_passes_payload(monkeypatch) -> None:
    detail = _build_detail()
    captured: dict[str, object] = {}

    async def fake_create_memory_event(session, user_id, *, session_id, run_id, event_type, payload):
        del session
        captured["user_id"] = user_id
        captured["session_id"] = session_id
        captured["run_id"] = run_id
        captured["event_type"] = event_type
        captured["payload"] = payload
        return SimpleNamespace(id=uuid.uuid4())

    monkeypatch.setattr("app.services.agent._long_term_memory.create_memory_event", fake_create_memory_event)

    await append_agent_memory_event(
        object(),
        "00000000-0000-0000-0000-000000000001",
        session_id=detail.sessionId,
        run_id=detail.id,
        detail=detail,
    )

    assert captured["event_type"] == "run_completed"
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["finalText"] == "好的，我会用中文，并避免自动改财务记录。"


@pytest.mark.asyncio
async def test_build_long_term_memory_context_joins_identity_and_task_blocks(monkeypatch) -> None:
    user_id = "00000000-0000-0000-0000-000000000001"
    session_id = "00000000-0000-0000-0000-000000000002"

    async def fake_get_memory_block(session, requested_user_id, *, block_type, scope_type, scope_id):
        del session, requested_user_id
        if block_type == "identity":
            return SimpleNamespace(content="以后默认中文回答")
        if block_type == "task":
            return SimpleNamespace(content="当前目标：整理热力学复习提纲")
        return None

    monkeypatch.setattr("app.services.agent._long_term_memory.get_memory_block", fake_get_memory_block)

    context = await build_long_term_memory_context(object(), user_id, session_id=session_id)

    assert "【个人长期记忆】" in context
    assert "以后默认中文回答" in context
    assert "【当前任务记忆】" in context
    assert "整理热力学复习提纲" in context


@pytest.mark.asyncio
async def test_consolidate_agent_memory_events_derives_records_and_refreshes_cache(monkeypatch) -> None:
    event_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    user_id = "00000000-0000-0000-0000-000000000001"

    pending_event = SimpleNamespace(
        id=uuid.UUID(event_id),
        run_id=uuid.UUID(run_id),
        session_id=uuid.UUID(session_id),
        payload_json={
            "status": "completed",
            "finalText": "好的，我会用中文，并避免自动改财务记录。",
            "messages": [
                {"id": "u1", "role": "user", "content": "以后默认中文回答，并且不要自动修改财务记录", "createdAt": 1},
                {"id": "a1", "role": "assistant", "content": "好的，我会用中文，并避免自动改财务记录。", "createdAt": 2},
            ],
            "executedToolCalls": [],
            "pendingToolCalls": [],
            "timeline": [],
        },
    )

    records: list[tuple[str, str, str]] = []
    blocks: list[tuple[str, str, str]] = []
    update_calls: list[dict[str, object]] = []

    async def fake_list_pending_memory_events(session, requested_user_id, *, session_id=None, limit=50):
        del session, requested_user_id, session_id, limit
        return [pending_event]

    async def fake_upsert_memory_record(session, requested_user_id, **kwargs):
        del session, requested_user_id
        records.append((kwargs["scope_type"], kwargs["memory_kind"], kwargs["memory_slot"]))
        return SimpleNamespace(id=uuid.uuid4())

    async def fake_upsert_memory_block(session, requested_user_id, **kwargs):
        del session, requested_user_id
        blocks.append((kwargs["block_type"], kwargs["scope_type"], kwargs["scope_id"]))
        return SimpleNamespace(id=uuid.uuid4(), content=kwargs["content"])

    async def fake_mark_memory_event_processed(session, requested_user_id, current_event_id, *, status):
        del session, requested_user_id
        assert current_event_id == event_id
        assert status == "processed"
        return SimpleNamespace(id=uuid.UUID(event_id))

    async def fake_list_memory_records_for_scope(session, requested_user_id, *, scope_type, scope_id):
        del session, requested_user_id
        if scope_type == "user":
            return [
                SimpleNamespace(memory_slot="preference", content="以后默认中文回答"),
                SimpleNamespace(memory_slot="rule", content="不要自动修改财务记录"),
            ]
        if scope_type == "session":
            return [
                SimpleNamespace(memory_slot="goal", content="以后默认中文回答，并且不要自动修改财务记录"),
                SimpleNamespace(memory_slot="episode", content="好的，我会用中文，并避免自动改财务记录。"),
                SimpleNamespace(memory_slot="profile", summary="当前重点：以后默认中文回答，并且不要自动修改财务记录"),
            ]
        raise AssertionError((scope_type, scope_id))

    async def fake_update_agent_session(session, requested_user_id, current_session_id, **kwargs):
        del session, requested_user_id, current_session_id
        update_calls.append(kwargs)
        return SimpleNamespace(
            id=uuid.UUID(session_id),
            user_id=uuid.UUID(user_id),
            title="Session",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )

    async def fake_list_runs_for_session(session, requested_user_id, current_session_id):
        del session, requested_user_id, current_session_id
        return [SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(id=uuid.uuid4())]

    monkeypatch.setattr("app.services.agent._long_term_memory.list_pending_memory_events", fake_list_pending_memory_events)
    monkeypatch.setattr("app.services.agent._long_term_memory.upsert_memory_record", fake_upsert_memory_record)
    monkeypatch.setattr("app.services.agent._long_term_memory.upsert_memory_block", fake_upsert_memory_block)
    monkeypatch.setattr("app.services.agent._long_term_memory.mark_memory_event_processed", fake_mark_memory_event_processed)
    monkeypatch.setattr("app.services.agent._long_term_memory.list_memory_records_for_scope", fake_list_memory_records_for_scope)
    monkeypatch.setattr("app.services.agent._long_term_memory.update_agent_session", fake_update_agent_session)
    monkeypatch.setattr("app.services.agent._long_term_memory.list_runs_for_session", fake_list_runs_for_session)

    await consolidate_agent_memory_events(object(), user_id, session_id=session_id)

    assert ("user", "semantic", "preference") in records
    assert ("user", "semantic", "rule") in records
    assert ("session", "episodic", "profile") in records
    assert ("identity", "user", user_id) in blocks
    assert ("task", "session", session_id) in blocks
    assert update_calls
    assert update_calls[-1]["memory_status"] == "ready"


@pytest.mark.asyncio
async def test_clear_long_term_memory_for_session_deletes_records_and_blocks(monkeypatch) -> None:
    calls: list[tuple[str, str, str]] = []

    async def fake_delete_memory_records_for_scope(session, requested_user_id, *, scope_type, scope_id):
        del session, requested_user_id
        calls.append(("records", scope_type, scope_id))
        return 1

    async def fake_delete_memory_blocks_for_scope(session, requested_user_id, *, scope_type, scope_id):
        del session, requested_user_id
        calls.append(("blocks", scope_type, scope_id))
        return 2

    monkeypatch.setattr(
        "app.services.agent._long_term_memory.delete_memory_records_for_scope",
        fake_delete_memory_records_for_scope,
    )
    monkeypatch.setattr(
        "app.services.agent._long_term_memory.delete_memory_blocks_for_scope",
        fake_delete_memory_blocks_for_scope,
    )

    await clear_long_term_memory_for_session(
        object(),
        "00000000-0000-0000-0000-000000000001",
        session_id="00000000-0000-0000-0000-000000000002",
    )

    assert calls == [
        ("records", "session", "00000000-0000-0000-0000-000000000002"),
        ("blocks", "session", "00000000-0000-0000-0000-000000000002"),
    ]
