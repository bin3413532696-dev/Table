from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

import app.services.agent._execution as agent_execution
from app.db.models import AgentRun, AgentSession, UserSetting
from app.schemas.agent import AgentRunToolExecutionDto, CreateAgentRunRequest

from .agent_stream_test_helpers import patch_agent_symbol


@pytest.mark.asyncio
async def test_stream_agent_run_record_streams_tokens_and_final_detail(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    user_uuid = uuid.UUID(user_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=UTC)
    completed_at = created_at + timedelta(seconds=1)

    session_item = AgentSession(
        id=session_id,
        user_id=user_uuid,
        title="Existing Session",
        created_at=created_at,
        updated_at=created_at,
    )
    created_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
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
        user_id=user_uuid,
        session_id=session_id,
        status="completed",
        input_text="Say hi",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=completed_at,
        version=2,
    )
    user_setting = UserSetting(
        id=uuid.uuid4(),
        user_id=user_uuid,
        agent_preferences_json={"systemPrompt": "You are concise."},
    )

    update_statuses: list[str] = []

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
            headers_json={"x-test": "1"},
        )

    async def fake_find_agent_session_by_id(session, requested_user_id, requested_session_id):
        del session
        assert requested_user_id == user_id
        assert requested_session_id == str(session_id)
        return session_item

    async def fake_find_user_setting(session, requested_user_id):
        del session
        assert requested_user_id == user_id
        return user_setting

    async def fake_create_agent_run(session, requested_user_id, *, session_id, input_text, model, status):
        del session
        assert requested_user_id == user_id
        assert session_id == str(session_item.id)
        assert input_text == "Say hi"
        assert model == "gpt-4o-mini"
        assert status == "running"
        return created_run

    async def fake_update_agent_session(session, requested_user_id, requested_session_id, *, title=None):
        del session, title
        assert requested_user_id == user_id
        assert requested_session_id == str(session_item.id)
        return session_item

    async def fake_update_agent_run(
        session,
        requested_user_id,
        requested_run_id,
        *,
        status=None,
        messages_json=None,
        executed_tool_calls_json=None,
        pending_tool_calls_json=None,
        assistant_text_chunks_json=None,
        timeline_json=None,
        final_text=None,
        error_text=object(),
        iteration_count=None,
        requires_confirmation=None,
        expected_version=None,
    ):
        del session, expected_version, messages_json, executed_tool_calls_json, pending_tool_calls_json
        del assistant_text_chunks_json, timeline_json, final_text, error_text, iteration_count, requires_confirmation
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        assert status is not None
        update_statuses.append(status)
        return completed_run if status == "completed" else created_run

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        return completed_run

    async def fake_stream_openai_chat_completion(runtime_config, *, messages):
        assert runtime_config.model == "gpt-4o-mini"
        assert messages[0]["role"] == "system"
        assert messages[0]["content"].startswith("You are concise.")
        assert "query_tasks" in messages[0]["content"]
        assert messages[-1] == {"role": "user", "content": "Say hi"}
        yield "Hello"
        yield " world"

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)
    patch_agent_symbol(monkeypatch, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    patch_agent_symbol(monkeypatch, "find_agent_session_by_id", fake_find_agent_session_by_id)
    patch_agent_symbol(monkeypatch, "find_user_setting", fake_find_user_setting)
    patch_agent_symbol(monkeypatch, "create_agent_run", fake_create_agent_run)
    patch_agent_symbol(monkeypatch, "update_agent_session", fake_update_agent_session)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    payload = CreateAgentRunRequest(
        sessionId=session_id,
        inputText="Say hi",
        model="default",
        initialMessages=[
            {"role": "assistant", "content": "Earlier answer"},
            {"role": "tool", "content": "ignored tool output"},
        ],
    )

    events = [event async for event in agent_execution.stream_agent_run_record(object(), user_id, payload)]

    assert events[0] == {
        "type": "metadata",
        "runId": str(run_id),
        "sessionId": str(session_id),
        "model": "gpt-4o-mini",
    }
    assert [event["token"] for event in events if event["type"] == "token"] == ["Hello", " world"]
    assert update_statuses == ["completed"]

    final_event = events[-1]
    assert final_event["type"] == "run_completed"
    run = final_event["run"]
    assert run["status"] == "completed"
    assert run["finalText"] == "Hello world"
    assert run["assistantTextChunks"] == ["Hello world"]
    assert [message["role"] for message in run["messages"]] == ["system", "assistant", "user", "assistant"]
    assert run["messages"][-1]["content"] == "Hello world"


@pytest.mark.asyncio
async def test_stream_agent_run_record_marks_run_failed_on_stream_error(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    user_uuid = uuid.UUID(user_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=UTC)

    session_item = AgentSession(
        id=session_id,
        user_id=user_uuid,
        title="Existing Session",
        created_at=created_at,
        updated_at=created_at,
    )
    created_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
        session_id=session_id,
        status="running",
        input_text="Say hi",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=created_at,
        version=1,
    )

    update_statuses: list[str] = []

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

    async def fake_update_agent_session(session, requested_user_id, requested_session_id, *, title=None):
        del session, title
        assert requested_user_id == user_id
        assert requested_session_id == str(session_item.id)
        return session_item

    async def fake_update_agent_run(
        session,
        requested_user_id,
        requested_run_id,
        *,
        status=None,
        messages_json=None,
        executed_tool_calls_json=None,
        pending_tool_calls_json=None,
        assistant_text_chunks_json=None,
        timeline_json=None,
        final_text=None,
        error_text=object(),
        iteration_count=None,
        requires_confirmation=None,
        expected_version=None,
    ):
        del session, expected_version, messages_json, executed_tool_calls_json, pending_tool_calls_json
        del assistant_text_chunks_json, timeline_json, final_text, error_text, iteration_count, requires_confirmation
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        assert status is not None
        update_statuses.append(status)
        return created_run

    async def fake_stream_openai_chat_completion(runtime_config, *, messages):
        del runtime_config, messages
        raise RuntimeError("provider stream failed")
        yield

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)
    patch_agent_symbol(monkeypatch, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    patch_agent_symbol(monkeypatch, "find_agent_session_by_id", fake_find_agent_session_by_id)
    patch_agent_symbol(monkeypatch, "find_user_setting", fake_find_user_setting)
    patch_agent_symbol(monkeypatch, "create_agent_run", fake_create_agent_run)
    patch_agent_symbol(monkeypatch, "update_agent_session", fake_update_agent_session)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    payload = CreateAgentRunRequest(
        sessionId=session_id,
        inputText="Say hi",
        model="default",
    )

    with pytest.raises(RuntimeError, match="provider stream failed"):
        async for _event in agent_execution.stream_agent_run_record(object(), user_id, payload):
            pass

    assert update_statuses == ["failed"]


@pytest.mark.asyncio
async def test_stream_agent_run_record_executes_query_tool_and_continues(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    user_uuid = uuid.UUID(user_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=UTC)
    completed_at = created_at + timedelta(seconds=2)

    session_item = AgentSession(
        id=session_id,
        user_id=user_uuid,
        title="Tool Session",
        created_at=created_at,
        updated_at=created_at,
    )
    created_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
        session_id=session_id,
        status="running",
        input_text="List pending tasks",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=created_at,
        version=1,
    )
    completed_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
        session_id=session_id,
        status="completed",
        input_text="List pending tasks",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=completed_at,
        version=2,
    )

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
        assert input_text == "List pending tasks"
        assert model == "gpt-4o-mini"
        assert status == "running"
        return created_run

    async def fake_update_agent_session(session, requested_user_id, requested_session_id, *, title=None):
        del session, title
        assert requested_user_id == user_id
        assert requested_session_id == str(session_item.id)
        return session_item

    async def fake_update_agent_run(
        session,
        requested_user_id,
        requested_run_id,
        *,
        status=None,
        messages_json=None,
        executed_tool_calls_json=None,
        pending_tool_calls_json=None,
        assistant_text_chunks_json=None,
        timeline_json=None,
        final_text=None,
        error_text=object(),
        iteration_count=None,
        requires_confirmation=None,
        expected_version=None,
    ):
        del session, expected_version, error_text
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        assert status == "completed"
        assert requires_confirmation is False
        assert pending_tool_calls_json == []
        assert isinstance(executed_tool_calls_json, list) and len(executed_tool_calls_json) == 1
        assert executed_tool_calls_json[0]["toolName"] == "query_tasks"
        assert executed_tool_calls_json[0]["status"] == "completed"
        assert assistant_text_chunks_json == [
            '```tool\n{"name":"query_tasks","arguments":{"completed":false,"limit":2}}\n```',
            "You have 2 pending tasks.",
        ]
        assert final_text == "You have 2 pending tasks."
        assert iteration_count == 2
        assert isinstance(messages_json, list) and messages_json[-2]["role"] == "tool"
        assert "Tool query_tasks executed successfully" in messages_json[-2]["content"]
        assert isinstance(timeline_json, list) and any(item["type"] == "tool_start" for item in timeline_json)
        return completed_run

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        return completed_run

    async def fake_execute_agent_tool_call(session, requested_user_id, tool_call, *, settings=None):
        del session, settings
        assert requested_user_id == user_id
        assert tool_call.name == "query_tasks"
        return AgentRunToolExecutionDto(
            id=tool_call.id,
            toolName=tool_call.name,
            arguments=tool_call.arguments,
            status="completed",
            requiresConfirmation=False,
            result={
                "value": [
                    {"id": "task-1", "title": "A"},
                    {"id": "task-2", "title": "B"},
                ]
            },
            createdAt=4,
        )

    async def fake_stream_openai_chat_completion(runtime_config, *, messages):
        assert runtime_config.model == "gpt-4o-mini"
        if fake_stream_openai_chat_completion.call_count == 0:
            assert messages[-1] == {"role": "user", "content": "List pending tasks"}
            fake_stream_openai_chat_completion.call_count += 1
            yield '```tool\n{"name":"query_tasks","arguments":{"completed":false,"limit":2}}\n```'
            return

        assert messages[-1]["role"] == "user"
        assert "Tool query_tasks executed successfully" in messages[-1]["content"]
        fake_stream_openai_chat_completion.call_count += 1
        yield "You have 2 pending tasks."

    fake_stream_openai_chat_completion.call_count = 0

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)
    patch_agent_symbol(monkeypatch, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    patch_agent_symbol(monkeypatch, "find_agent_session_by_id", fake_find_agent_session_by_id)
    patch_agent_symbol(monkeypatch, "find_user_setting", fake_find_user_setting)
    patch_agent_symbol(monkeypatch, "create_agent_run", fake_create_agent_run)
    patch_agent_symbol(monkeypatch, "update_agent_session", fake_update_agent_session)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "_execute_agent_tool_call", fake_execute_agent_tool_call)
    patch_agent_symbol(monkeypatch, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    payload = CreateAgentRunRequest(sessionId=session_id, inputText="List pending tasks", model="default")

    events = [event async for event in agent_execution.stream_agent_run_record(object(), user_id, payload)]

    assert events[0] == {
        "type": "metadata",
        "runId": str(run_id),
        "sessionId": str(session_id),
        "model": "gpt-4o-mini",
    }
    assert [event["token"] for event in events if event["type"] == "token"] == [
        '```tool\n{"name":"query_tasks","arguments":{"completed":false,"limit":2}}\n```',
        "You have 2 pending tasks.",
    ]
    assert events[-1]["type"] == "run_completed"
    assert events[-1]["run"]["status"] == "completed"
    assert events[-1]["run"]["finalText"] == "You have 2 pending tasks."


@pytest.mark.asyncio
async def test_stream_agent_run_record_preexecutes_rag_when_enabled(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    user_uuid = uuid.UUID(user_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=UTC)
    completed_at = created_at + timedelta(seconds=1)

    session_item = AgentSession(
        id=session_id,
        user_id=user_uuid,
        title="RAG Session",
        created_at=created_at,
        updated_at=created_at,
    )
    created_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
        session_id=session_id,
        status="running",
        input_text="知识库里怎么说 Transformer",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=created_at,
        version=1,
    )
    completed_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
        session_id=session_id,
        status="completed",
        input_text="知识库里怎么说 Transformer",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=completed_at,
        version=2,
    )

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
        assert input_text == "知识库里怎么说 Transformer"
        assert model == "gpt-4o-mini"
        assert status == "running"
        return created_run

    async def fake_update_agent_session(session, requested_user_id, requested_session_id, *, title=None):
        del session, title
        assert requested_user_id == user_id
        assert requested_session_id == str(session_item.id)
        return session_item

    async def fake_update_agent_run(
        session,
        requested_user_id,
        requested_run_id,
        *,
        status=None,
        messages_json=None,
        executed_tool_calls_json=None,
        pending_tool_calls_json=None,
        assistant_text_chunks_json=None,
        timeline_json=None,
        final_text=None,
        error_text=object(),
        iteration_count=None,
        requires_confirmation=None,
        expected_version=None,
    ):
        del session, expected_version, error_text
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        assert status == "completed"
        assert requires_confirmation is False
        assert pending_tool_calls_json == []
        assert isinstance(executed_tool_calls_json, list) and len(executed_tool_calls_json) == 1
        assert executed_tool_calls_json[0]["toolName"] == "rag_answer"
        assert assistant_text_chunks_json == ["知识库结果显示：Transformer 是核心架构。"]
        assert final_text == "知识库结果显示：Transformer 是核心架构。"
        assert iteration_count == 1
        assert isinstance(messages_json, list) and messages_json[-2]["role"] == "tool"
        assert "Tool rag_answer executed successfully" in messages_json[-2]["content"]
        return completed_run

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        return completed_run

    async def fake_execute_agent_tool_call(session, requested_user_id, tool_call, *, settings=None):
        del session, settings
        assert requested_user_id == user_id
        assert tool_call.name == "rag_answer"
        assert tool_call.arguments["question"] == "知识库里怎么说 Transformer"
        return AgentRunToolExecutionDto(
            id=tool_call.id,
            toolName=tool_call.name,
            arguments=tool_call.arguments,
            status="completed",
            requiresConfirmation=False,
            result={
                "context": "[Doc] Transformer 是核心架构。",
                "sources": [{"chunkId": "chunk-1", "documentTitle": "大模型发展历程.txt", "score": 0.9}],
                "confidence": 0.9,
                "message": "找到 1 条相关内容，置信度 90%",
                "searched": True,
            },
            createdAt=4,
        )

    async def fake_stream_openai_chat_completion(runtime_config, *, messages):
        assert runtime_config.model == "gpt-4o-mini"
        assert messages[-1]["role"] == "user"
        assert "Tool rag_answer executed successfully" in messages[-1]["content"]
        yield "知识库结果显示：Transformer 是核心架构。"

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)
    patch_agent_symbol(monkeypatch, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    patch_agent_symbol(monkeypatch, "find_agent_session_by_id", fake_find_agent_session_by_id)
    patch_agent_symbol(monkeypatch, "find_user_setting", fake_find_user_setting)
    patch_agent_symbol(monkeypatch, "create_agent_run", fake_create_agent_run)
    patch_agent_symbol(monkeypatch, "update_agent_session", fake_update_agent_session)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "_execute_agent_tool_call", fake_execute_agent_tool_call)
    patch_agent_symbol(monkeypatch, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    payload = CreateAgentRunRequest(
        sessionId=session_id,
        inputText="知识库里怎么说 Transformer",
        model="default",
        ragEnabled=True,
    )

    events = [event async for event in agent_execution.stream_agent_run_record(object(), user_id, payload)]

    assert events[0] == {
        "type": "metadata",
        "runId": str(run_id),
        "sessionId": str(session_id),
        "model": "gpt-4o-mini",
    }
    assert [event["token"] for event in events if event["type"] == "token"] == [
        "知识库结果显示：Transformer 是核心架构。",
    ]
    assert events[-1]["type"] == "run_completed"
    assert events[-1]["run"]["status"] == "completed"
    assert events[-1]["run"]["executedToolCalls"][0]["toolName"] == "rag_answer"
    assert events[-1]["run"]["finalText"] == "知识库结果显示：Transformer 是核心架构。"


@pytest.mark.asyncio
async def test_stream_agent_run_record_enters_waiting_confirmation_for_write_tool(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    user_uuid = uuid.UUID(user_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=UTC)
    waiting_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
        session_id=session_id,
        status="waiting_confirmation",
        input_text="Create a task",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=created_at,
        version=2,
    )

    session_item = AgentSession(
        id=session_id,
        user_id=user_uuid,
        title="Write Session",
        created_at=created_at,
        updated_at=created_at,
    )
    created_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
        session_id=session_id,
        status="running",
        input_text="Create a task",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=created_at,
        version=1,
    )

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
        assert input_text == "Create a task"
        assert model == "gpt-4o-mini"
        assert status == "running"
        return created_run

    async def fake_update_agent_session(session, requested_user_id, requested_session_id, *, title=None):
        del session, title
        assert requested_user_id == user_id
        assert requested_session_id == str(session_item.id)
        return session_item

    async def fake_update_agent_run(
        session,
        requested_user_id,
        requested_run_id,
        *,
        status=None,
        messages_json=None,
        executed_tool_calls_json=None,
        pending_tool_calls_json=None,
        assistant_text_chunks_json=None,
        timeline_json=None,
        final_text=None,
        error_text=object(),
        iteration_count=None,
        requires_confirmation=None,
        expected_version=None,
    ):
        del session, expected_version, messages_json, executed_tool_calls_json, assistant_text_chunks_json
        del timeline_json, final_text, error_text
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        assert status == "waiting_confirmation"
        assert requires_confirmation is True
        assert iteration_count == 1
        assert isinstance(pending_tool_calls_json, list) and len(pending_tool_calls_json) == 1
        assert pending_tool_calls_json[0]["toolName"] == "create_task"
        return waiting_run

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        return waiting_run

    async def fake_stream_openai_chat_completion(runtime_config, *, messages):
        del runtime_config
        assert messages[-1] == {"role": "user", "content": "Create a task"}
        yield '```tool\n{"name":"create_task","arguments":{"title":"Write report","priority":"high"}}\n```'

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)
    patch_agent_symbol(monkeypatch, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    patch_agent_symbol(monkeypatch, "find_agent_session_by_id", fake_find_agent_session_by_id)
    patch_agent_symbol(monkeypatch, "find_user_setting", fake_find_user_setting)
    patch_agent_symbol(monkeypatch, "create_agent_run", fake_create_agent_run)
    patch_agent_symbol(monkeypatch, "update_agent_session", fake_update_agent_session)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    payload = CreateAgentRunRequest(sessionId=session_id, inputText="Create a task", model="default")

    events = [event async for event in agent_execution.stream_agent_run_record(object(), user_id, payload)]

    assert events[0] == {
        "type": "metadata",
        "runId": str(run_id),
        "sessionId": str(session_id),
        "model": "gpt-4o-mini",
    }
    assert [event["token"] for event in events if event["type"] == "token"] == [
        '```tool\n{"name":"create_task","arguments":{"title":"Write report","priority":"high"}}\n```'
    ]
    assert events[-1]["type"] == "run_completed"
    assert events[-1]["run"]["status"] == "waiting_confirmation"
    assert events[-1]["run"]["requiresConfirmation"] is True
    assert events[-1]["run"]["pendingToolCalls"][0]["toolName"] == "create_task"


@pytest.mark.asyncio
async def test_stream_agent_run_record_executes_safe_tools_before_waiting_for_confirmation(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    user_uuid = uuid.UUID(user_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=UTC)
    waiting_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
        session_id=session_id,
        status="waiting_confirmation",
        input_text="List tasks and create one",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=created_at,
        version=2,
    )

    session_item = AgentSession(
        id=session_id,
        user_id=user_uuid,
        title="Mixed Tool Session",
        created_at=created_at,
        updated_at=created_at,
    )
    created_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
        session_id=session_id,
        status="running",
        input_text="List tasks and create one",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=created_at,
        version=1,
    )

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
        assert input_text == "List tasks and create one"
        assert model == "gpt-4o-mini"
        assert status == "running"
        return created_run

    async def fake_update_agent_session(session, requested_user_id, requested_session_id, *, title=None):
        del session, title
        assert requested_user_id == user_id
        assert requested_session_id == str(session_item.id)
        return session_item

    async def fake_update_agent_run(
        session,
        requested_user_id,
        requested_run_id,
        *,
        status=None,
        messages_json=None,
        executed_tool_calls_json=None,
        pending_tool_calls_json=None,
        assistant_text_chunks_json=None,
        timeline_json=None,
        final_text=None,
        error_text=object(),
        iteration_count=None,
        requires_confirmation=None,
        expected_version=None,
    ):
        del session, expected_version, error_text
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        assert status == "waiting_confirmation"
        assert requires_confirmation is True
        assert iteration_count == 1
        assert isinstance(executed_tool_calls_json, list) and len(executed_tool_calls_json) == 1
        assert executed_tool_calls_json[0]["toolName"] == "query_tasks"
        assert isinstance(pending_tool_calls_json, list) and len(pending_tool_calls_json) == 1
        assert pending_tool_calls_json[0]["toolName"] == "create_task"
        assert isinstance(messages_json, list) and messages_json[-1]["role"] == "tool"
        assert "Tool query_tasks executed successfully" in messages_json[-1]["content"]
        assert assistant_text_chunks_json == [
            "```tool\n"
            '{"name":"query_tasks","arguments":{"completed":false,"limit":2}}\n'
            "```\n"
            "```tool\n"
            '{"name":"create_task","arguments":{"title":"Write report","priority":"high"}}\n'
            "```"
        ]
        assert final_text == ""
        assert isinstance(timeline_json, list) and any(item["type"] == "tool_start" for item in timeline_json)
        return waiting_run

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        return waiting_run

    async def fake_execute_agent_tool_call(session, requested_user_id, tool_call, *, settings=None):
        del session, settings
        assert requested_user_id == user_id
        assert tool_call.name == "query_tasks"
        return AgentRunToolExecutionDto(
            id=tool_call.id,
            toolName=tool_call.name,
            arguments=tool_call.arguments,
            status="completed",
            requiresConfirmation=False,
            result={"value": [{"id": "task-1", "title": "A"}]},
            createdAt=4,
        )

    async def fake_stream_openai_chat_completion(runtime_config, *, messages):
        del runtime_config
        assert messages[-1] == {"role": "user", "content": "List tasks and create one"}
        yield (
            '```tool\n{"name":"query_tasks","arguments":{"completed":false,"limit":2}}\n```\n'
            '```tool\n{"name":"create_task","arguments":{"title":"Write report","priority":"high"}}\n```'
        )

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)
    patch_agent_symbol(monkeypatch, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    patch_agent_symbol(monkeypatch, "find_agent_session_by_id", fake_find_agent_session_by_id)
    patch_agent_symbol(monkeypatch, "find_user_setting", fake_find_user_setting)
    patch_agent_symbol(monkeypatch, "create_agent_run", fake_create_agent_run)
    patch_agent_symbol(monkeypatch, "update_agent_session", fake_update_agent_session)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "_execute_agent_tool_call", fake_execute_agent_tool_call)
    patch_agent_symbol(monkeypatch, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    payload = CreateAgentRunRequest(sessionId=session_id, inputText="List tasks and create one", model="default")

    events = [event async for event in agent_execution.stream_agent_run_record(object(), user_id, payload)]

    assert events[-1]["type"] == "run_completed"
    assert events[-1]["run"]["status"] == "waiting_confirmation"
    assert events[-1]["run"]["pendingToolCalls"][0]["toolName"] == "create_task"


@pytest.mark.asyncio
async def test_stream_agent_run_record_supports_anthropic_provider(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    user_uuid = uuid.UUID(user_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=UTC)
    completed_at = created_at + timedelta(seconds=1)

    session_item = AgentSession(
        id=session_id,
        user_id=user_uuid,
        title="Anthropic Session",
        created_at=created_at,
        updated_at=created_at,
    )
    created_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
        session_id=session_id,
        status="running",
        input_text="Explain briefly",
        model="claude-3-5-sonnet-latest",
        created_at=created_at,
        updated_at=created_at,
        version=1,
    )
    completed_run = AgentRun(
        id=run_id,
        user_id=user_uuid,
        session_id=session_id,
        status="completed",
        input_text="Explain briefly",
        model="claude-3-5-sonnet-latest",
        created_at=created_at,
        updated_at=completed_at,
        version=2,
    )
    user_setting = UserSetting(
        id=uuid.uuid4(),
        user_id=user_uuid,
        agent_preferences_json={"systemPrompt": "Be concise."},
    )

    update_statuses: list[str] = []

    async def fake_find_active_provider_for_user(session, requested_user_id):
        del session
        assert requested_user_id == user_id
        return SimpleNamespace(
            id=uuid.uuid4(),
            name="Claude Provider",
            api_format="anthropic",
            base_url="https://api.anthropic.com/",
            api_key_encrypted="encrypted-secret",
            model="claude-3-5-sonnet-latest",
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
        return user_setting

    async def fake_create_agent_run(session, requested_user_id, *, session_id, input_text, model, status):
        del session
        assert requested_user_id == user_id
        assert session_id == str(session_item.id)
        assert input_text == "Explain briefly"
        assert model == "claude-3-5-sonnet-latest"
        assert status == "running"
        return created_run

    async def fake_update_agent_session(session, requested_user_id, requested_session_id, *, title=None):
        del session, title
        assert requested_user_id == user_id
        assert requested_session_id == str(session_item.id)
        return session_item

    async def fake_update_agent_run(
        session,
        requested_user_id,
        requested_run_id,
        *,
        status=None,
        messages_json=None,
        executed_tool_calls_json=None,
        pending_tool_calls_json=None,
        assistant_text_chunks_json=None,
        timeline_json=None,
        final_text=None,
        error_text=object(),
        iteration_count=None,
        requires_confirmation=None,
        expected_version=None,
    ):
        del session, expected_version, messages_json, executed_tool_calls_json, pending_tool_calls_json
        del assistant_text_chunks_json, timeline_json, final_text, error_text, iteration_count, requires_confirmation
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        assert status is not None
        update_statuses.append(status)
        return completed_run if status == "completed" else created_run

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == str(run_id)
        return completed_run

    async def fake_stream_anthropic_messages(runtime_config, *, messages):
        assert runtime_config.api_format == "anthropic"
        assert runtime_config.model == "claude-3-5-sonnet-latest"
        assert messages[0]["content"].startswith("Be concise.")
        assert messages[-1] == {"role": "user", "content": "Explain briefly"}
        yield "Claude"
        yield " reply"

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)
    patch_agent_symbol(monkeypatch, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    patch_agent_symbol(monkeypatch, "find_agent_session_by_id", fake_find_agent_session_by_id)
    patch_agent_symbol(monkeypatch, "find_user_setting", fake_find_user_setting)
    patch_agent_symbol(monkeypatch, "create_agent_run", fake_create_agent_run)
    patch_agent_symbol(monkeypatch, "update_agent_session", fake_update_agent_session)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "_stream_anthropic_messages", fake_stream_anthropic_messages)

    payload = CreateAgentRunRequest(
        sessionId=session_id,
        inputText="Explain briefly",
        model="default",
    )

    events = [event async for event in agent_execution.stream_agent_run_record(object(), user_id, payload)]

    assert events[0] == {
        "type": "metadata",
        "runId": str(run_id),
        "sessionId": str(session_id),
        "model": "claude-3-5-sonnet-latest",
    }
    assert [event["token"] for event in events if event["type"] == "token"] == ["Claude", " reply"]
    assert update_statuses == ["completed"]
    assert events[-1]["run"]["finalText"] == "Claude reply"
