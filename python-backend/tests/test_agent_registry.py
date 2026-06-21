from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

import app.services.agent._execution as agent_execution
import app.services.agent._runs as agent_runs
import app.services.agent._runtime_support as agent_runtime_support
from app.db.models import AgentRun, AgentSession
from app.schemas.agent import CreateAgentRunRequest
from app.services.agent.registry import (
    AgentLifecycleHook,
    get_agent_hook_manager,
    list_provider_capabilities,
    list_tool_capabilities,
)


def test_registry_exposes_provider_and_tool_capabilities() -> None:
    provider_formats = {item.apiFormat for item in list_provider_capabilities()}
    tool_names = {item.name for item in list_tool_capabilities()}

    assert {"openai", "anthropic", "gemini", "custom"}.issubset(provider_formats)
    assert "query_tasks" in tool_names
    assert "create_task" in tool_names
    assert "rag_answer" in tool_names


@pytest.mark.asyncio
async def test_stream_agent_run_record_fires_core_lifecycle_hooks(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 6, 1, 8, 0, tzinfo=UTC)

    session_item = AgentSession(
        id=session_id,
        user_id=uuid.UUID(user_id),
        title="Hook Session",
        created_at=created_at,
        updated_at=created_at,
    )
    created_run = AgentRun(
        id=run_id,
        user_id=uuid.UUID(user_id),
        session_id=session_id,
        status="running",
        input_text="Say hi",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=created_at,
        version=1,
    )
    completed_run = AgentRun(
        id=run_id,
        user_id=uuid.UUID(user_id),
        session_id=session_id,
        status="completed",
        input_text="Say hi",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=created_at,
        version=2,
    )

    events: list[str] = []

    class RecordingHook(AgentLifecycleHook):
        async def on_run_start(self, **_: object) -> None:
            events.append("on_run_start")

        async def before_llm(self, **_: object) -> None:
            events.append("before_llm")

        async def after_llm(self, **_: object) -> None:
            events.append("after_llm")

        async def on_run_end(self, **_: object) -> None:
            events.append("on_run_end")

    hook_manager = get_agent_hook_manager()
    hook = RecordingHook()
    hook_manager.hooks.append(hook)

    async def fake_find_active_provider_for_user(session, requested_user_id):
        del session
        assert requested_user_id == user_id
        return SimpleNamespace(
            id=uuid.uuid4(),
            name="Primary Provider",
            api_format="openai",
            base_url="https://provider.example.com/",
            api_key_encrypted="encrypted-secret",
            model="gpt-4o-mini",
            headers_json={},
        )

    async def fake_find_agent_session_by_id(session, requested_user_id, requested_session_id):
        del session
        assert requested_user_id == user_id
        assert requested_session_id == str(session_id)
        return session_item

    async def fake_find_user_setting(session, requested_user_id):
        del session
        assert requested_user_id == user_id
        return None

    async def fake_create_agent_run(session, requested_user_id, *, session_id, input_text, model, status):
        del session
        assert requested_user_id == user_id
        assert session_id == str(session_item.id)
        assert input_text == "Say hi"
        assert model == "gpt-4o-mini"
        assert status == "running"
        return created_run

    async def fake_update_agent_session(session, requested_user_id, requested_session_id, **kwargs):
        del session, kwargs
        assert requested_user_id == user_id
        assert requested_session_id == str(session_item.id)
        return session_item

    async def fake_update_agent_run(session, requested_user_id, requested_run_id, **kwargs):
        del session, kwargs
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        return completed_run

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        return completed_run

    async def fake_stream_provider_chat_completion(runtime_config, *, messages):
        assert runtime_config.api_format == "openai"
        assert runtime_config.model == "gpt-4o-mini"
        assert messages[-1] == {"role": "user", "content": "Say hi"}
        yield "Hello"

    monkeypatch.setattr(agent_runtime_support, "find_active_provider_for_user", fake_find_active_provider_for_user)
    monkeypatch.setattr(agent_runtime_support, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    monkeypatch.setattr(agent_runs, "find_agent_session_by_id", fake_find_agent_session_by_id)
    monkeypatch.setattr(agent_execution, "find_user_setting", fake_find_user_setting)
    monkeypatch.setattr(agent_execution, "create_agent_run", fake_create_agent_run)
    monkeypatch.setattr(agent_execution, "update_agent_session", fake_update_agent_session)
    monkeypatch.setattr(agent_runtime_support, "update_agent_run", fake_update_agent_run)
    monkeypatch.setattr(agent_execution, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_execution, "_stream_provider_chat_completion", fake_stream_provider_chat_completion)

    payload = CreateAgentRunRequest(sessionId=session_id, inputText="Say hi", model="default")

    try:
        events.clear()
        _ = [event async for event in agent_execution.stream_agent_run_record(object(), user_id, payload)]
    finally:
        hook_manager.hooks.remove(hook)

    assert events == ["on_run_start", "before_llm", "after_llm", "on_run_end"]
