from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import uuid

import pytest

from app.db.models import AgentRun, AgentSession, UserSetting
from app.schemas.agent import CreateAgentRunRequest
from app.services import agent as agent_service


def test_build_effective_system_prompt_blocks_tool_execution_for_explanations() -> None:
    prompt = agent_service._build_effective_system_prompt("", rag_enabled=False)

    assert "如果用户是在询问如何使用某个工具" in prompt
    assert "不要调用任何工具" in prompt
    assert "create_task(title!, priority?, dueDate?, description?)" in prompt


def test_extract_stream_delta_text_supports_string_and_array_content() -> None:
    assert (
        agent_service._extract_stream_delta_text(
            {"choices": [{"delta": {"content": "Hello"}}]}
        )
        == "Hello"
    )
    assert (
        agent_service._extract_stream_delta_text(
            {
                "choices": [
                    {
                        "delta": {
                            "content": [
                                {"text": "Hello"},
                                {"text": " world"},
                            ]
                        }
                    }
                ]
            }
        )
        == "Hello world"
    )


def test_extract_anthropic_stream_delta_text_supports_text_delta() -> None:
    assert (
        agent_service._extract_anthropic_stream_delta_text(
            {
                "type": "content_block_delta",
                "delta": {
                    "type": "text_delta",
                    "text": "Hello from Claude",
                },
            }
        )
        == "Hello from Claude"
    )


def test_extract_gemini_stream_delta_text_supports_candidate_parts() -> None:
    assert (
        agent_service._extract_gemini_stream_delta_text(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": "Hello"},
                                {"text": " Gemini"},
                            ]
                        }
                    }
                ]
            }
        )
        == "Hello Gemini"
    )


def test_to_agent_run_detail_exposes_placeholder_pending_tool_for_waiting_confirmation() -> None:
    run = AgentRun(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        status="waiting_confirmation",
        input_text="Approve the action",
        model="gpt-4o-mini",
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=timezone.utc),
        version=1,
    )

    detail = agent_service._to_agent_run_detail(run)

    assert detail.status == "waiting_confirmation"
    assert detail.requiresConfirmation is True
    assert len(detail.pendingToolCalls) == 1
    pending_tool = detail.pendingToolCalls[0]
    assert pending_tool.id == agent_service.PENDING_CONFIRMATION_TOOL_ID
    assert pending_tool.toolName == agent_service.PENDING_CONFIRMATION_TOOL_NAME
    assert pending_tool.status == "waiting_confirmation"


@pytest.mark.asyncio
async def test_get_agent_session_detail_aggregates_persisted_run_messages(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    session_uuid = uuid.UUID(session_id)
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc)
    session_item = AgentSession(
        id=session_uuid,
        user_id=uuid.uuid4(),
        title="Existing Session",
        created_at=created_at,
        updated_at=created_at,
    )
    first_run = AgentRun(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        session_id=session_uuid,
        status="completed",
        input_text="First question",
        model="gpt-4o-mini",
        messages_json=[
            {"id": "m1", "role": "user", "content": "First question", "createdAt": 1},
            {"id": "m2", "role": "assistant", "content": "First answer", "createdAt": 2},
        ],
        final_text="First answer",
        assistant_text_chunks_json=["First answer"],
        timeline_json=[],
        created_at=created_at,
        updated_at=created_at + timedelta(seconds=1),
        version=2,
    )
    second_run = AgentRun(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        session_id=session_uuid,
        status="completed",
        input_text="Second question",
        model="gpt-4o-mini",
        messages_json=[
            {"id": "m3", "role": "user", "content": "Second question", "createdAt": 3},
            {"id": "m4", "role": "assistant", "content": "Second answer", "createdAt": 4},
        ],
        final_text="Second answer",
        assistant_text_chunks_json=["Second answer"],
        timeline_json=[],
        created_at=created_at + timedelta(seconds=2),
        updated_at=created_at + timedelta(seconds=3),
        version=2,
    )

    async def fake_find_agent_session_by_id(session, requested_user_id, requested_session_id):
        del session
        assert requested_user_id == user_id
        assert requested_session_id == session_id
        return session_item

    async def fake_list_runs_for_session(session, requested_user_id, requested_session_id):
        del session
        assert requested_user_id == user_id
        assert requested_session_id == session_id
        return [first_run, second_run]

    monkeypatch.setattr(agent_service, "find_agent_session_by_id", fake_find_agent_session_by_id)
    monkeypatch.setattr(agent_service, "list_runs_for_session", fake_list_runs_for_session)

    detail = await agent_service.get_agent_session_detail(object(), user_id, session_id)

    assert detail is not None
    assert [message.content for message in detail.messages] == [
        "First question",
        "First answer",
        "Second question",
        "Second answer",
    ]


@pytest.mark.asyncio
async def test_create_agent_run_record_returns_final_detail_from_execution_stream(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    payload = CreateAgentRunRequest(inputText="Review the migration plan", model="default")

    async def fake_stream_agent_run_record(session, requested_user_id, requested_payload):
        del session
        assert requested_user_id == user_id
        assert requested_payload.inputText == payload.inputText
        yield {
            "type": "metadata",
            "runId": str(uuid.uuid4()),
            "sessionId": str(uuid.uuid4()),
            "model": "gpt-4o-mini",
        }
        yield {
            "type": "run_completed",
            "run": {
                "id": str(uuid.uuid4()),
                "sessionId": str(uuid.uuid4()),
                "status": "completed",
                "inputText": payload.inputText,
                "model": "gpt-4o-mini",
                "createdAt": 10,
                "updatedAt": 11,
                "version": 2,
                "messages": [],
                "executedToolCalls": [],
                "pendingToolCalls": [],
                "requiresConfirmation": False,
                "finalText": "Done",
                "error": None,
                "iterationCount": 1,
                "assistantTextChunks": ["Done"],
                "timeline": [],
            },
        }

    monkeypatch.setattr(agent_service, "stream_agent_run_record", fake_stream_agent_run_record)

    detail = await agent_service.create_agent_run_record(object(), user_id, payload)

    assert detail.status == "completed"
    assert detail.finalText == "Done"


@pytest.mark.asyncio
async def test_stream_agent_run_record_streams_tokens_and_final_detail(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    user_uuid = uuid.UUID(user_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc)
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

    monkeypatch.setattr(agent_service, "find_active_provider_for_user", fake_find_active_provider_for_user)
    monkeypatch.setattr(agent_service, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    monkeypatch.setattr(agent_service, "find_agent_session_by_id", fake_find_agent_session_by_id)
    monkeypatch.setattr(agent_service, "find_user_setting", fake_find_user_setting)
    monkeypatch.setattr(agent_service, "create_agent_run", fake_create_agent_run)
    monkeypatch.setattr(agent_service, "update_agent_session", fake_update_agent_session)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)
    monkeypatch.setattr(agent_service, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_service, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    payload = CreateAgentRunRequest(
        sessionId=session_id,
        inputText="Say hi",
        model="default",
        initialMessages=[
            {"role": "assistant", "content": "Earlier answer"},
            {"role": "tool", "content": "ignored tool output"},
        ],
    )

    events = [event async for event in agent_service.stream_agent_run_record(object(), user_id, payload)]

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
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc)

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

    monkeypatch.setattr(agent_service, "find_active_provider_for_user", fake_find_active_provider_for_user)
    monkeypatch.setattr(agent_service, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    monkeypatch.setattr(agent_service, "find_agent_session_by_id", fake_find_agent_session_by_id)
    monkeypatch.setattr(agent_service, "find_user_setting", fake_find_user_setting)
    monkeypatch.setattr(agent_service, "create_agent_run", fake_create_agent_run)
    monkeypatch.setattr(agent_service, "update_agent_session", fake_update_agent_session)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)
    monkeypatch.setattr(agent_service, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    payload = CreateAgentRunRequest(
        sessionId=session_id,
        inputText="Say hi",
        model="default",
    )

    with pytest.raises(RuntimeError, match="provider stream failed"):
        async for _event in agent_service.stream_agent_run_record(object(), user_id, payload):
            pass

    assert update_statuses == ["failed"]


@pytest.mark.asyncio
async def test_stream_agent_run_record_executes_query_tool_and_continues(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    user_uuid = uuid.UUID(user_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc)
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
        return agent_service.AgentRunToolExecutionDto(
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

    monkeypatch.setattr(agent_service, "find_active_provider_for_user", fake_find_active_provider_for_user)
    monkeypatch.setattr(agent_service, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    monkeypatch.setattr(agent_service, "find_agent_session_by_id", fake_find_agent_session_by_id)
    monkeypatch.setattr(agent_service, "find_user_setting", fake_find_user_setting)
    monkeypatch.setattr(agent_service, "create_agent_run", fake_create_agent_run)
    monkeypatch.setattr(agent_service, "update_agent_session", fake_update_agent_session)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)
    monkeypatch.setattr(agent_service, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_service, "_execute_agent_tool_call", fake_execute_agent_tool_call)
    monkeypatch.setattr(agent_service, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    payload = CreateAgentRunRequest(sessionId=session_id, inputText="List pending tasks", model="default")

    events = [event async for event in agent_service.stream_agent_run_record(object(), user_id, payload)]

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
async def test_stream_agent_run_record_enters_waiting_confirmation_for_write_tool(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    user_uuid = uuid.UUID(user_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc)
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

    monkeypatch.setattr(agent_service, "find_active_provider_for_user", fake_find_active_provider_for_user)
    monkeypatch.setattr(agent_service, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    monkeypatch.setattr(agent_service, "find_agent_session_by_id", fake_find_agent_session_by_id)
    monkeypatch.setattr(agent_service, "find_user_setting", fake_find_user_setting)
    monkeypatch.setattr(agent_service, "create_agent_run", fake_create_agent_run)
    monkeypatch.setattr(agent_service, "update_agent_session", fake_update_agent_session)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)
    monkeypatch.setattr(agent_service, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_service, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    payload = CreateAgentRunRequest(sessionId=session_id, inputText="Create a task", model="default")

    events = [event async for event in agent_service.stream_agent_run_record(object(), user_id, payload)]

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
async def test_stream_agent_run_record_supports_anthropic_provider(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    user_uuid = uuid.UUID(user_id)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc)
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
        assert messages[0]["role"] == "system"
        assert messages[0]["content"].startswith("Be concise.")
        assert "query_tasks" in messages[0]["content"]
        assert messages[-1] == {"role": "user", "content": "Explain briefly"}
        yield "Claude"
        yield " reply"

    monkeypatch.setattr(agent_service, "find_active_provider_for_user", fake_find_active_provider_for_user)
    monkeypatch.setattr(agent_service, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    monkeypatch.setattr(agent_service, "find_agent_session_by_id", fake_find_agent_session_by_id)
    monkeypatch.setattr(agent_service, "find_user_setting", fake_find_user_setting)
    monkeypatch.setattr(agent_service, "create_agent_run", fake_create_agent_run)
    monkeypatch.setattr(agent_service, "update_agent_session", fake_update_agent_session)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)
    monkeypatch.setattr(agent_service, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_service, "_stream_anthropic_messages", fake_stream_anthropic_messages)

    payload = CreateAgentRunRequest(
        sessionId=session_id,
        inputText="Explain briefly",
        model="default",
    )

    events = [event async for event in agent_service.stream_agent_run_record(object(), user_id, payload)]

    assert events[0] == {
        "type": "metadata",
        "runId": str(run_id),
        "sessionId": str(session_id),
        "model": "claude-3-5-sonnet-latest",
    }
    assert [event["token"] for event in events if event["type"] == "token"] == ["Claude", " reply"]
    assert update_statuses == ["completed"]
    assert events[-1]["run"]["finalText"] == "Claude reply"


@pytest.mark.asyncio
async def test_confirm_agent_tool_record_continues_waiting_confirmation_run(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    session_id = uuid.uuid4()
    run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=uuid.uuid4(),
        session_id=session_id,
        status="waiting_confirmation",
        input_text="Approve the action",
        model="gpt-4o-mini",
        messages_json=[
            {"id": "m1", "role": "user", "content": "Approve the action", "createdAt": 1},
            {"id": "m2", "role": "assistant", "content": "I am waiting for approval.", "createdAt": 2},
        ],
        pending_tool_calls_json=[
            {
                "id": agent_service.PENDING_CONFIRMATION_TOOL_ID,
                "toolName": agent_service.PENDING_CONFIRMATION_TOOL_NAME,
                "arguments": {"inputText": "Approve the action"},
                "status": "waiting_confirmation",
                "requiresConfirmation": True,
                "result": {"confirmationMessage": "Please approve."},
                "createdAt": 3,
            }
        ],
        requires_confirmation=True,
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=timezone.utc),
        version=1,
    )
    completed_run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=run.user_id,
        session_id=session_id,
        status="completed",
        input_text="Approve the action",
        model="gpt-4o-mini",
        created_at=run.created_at,
        updated_at=run.updated_at + timedelta(seconds=2),
        version=2,
    )

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == run_id
        return completed_run if fake_find_agent_run_by_id.after_persist else run
    fake_find_agent_run_by_id.after_persist = False

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
        assert requested_run_id == run_id
        assert status == "completed"
        assert requires_confirmation is False
        assert pending_tool_calls_json == []
        assert isinstance(executed_tool_calls_json, list) and len(executed_tool_calls_json) == 1
        assert final_text == "Approved continuation"
        assert assistant_text_chunks_json == ["Approved continuation"]
        assert iteration_count == 1
        assert isinstance(messages_json, list) and messages_json[-1]["content"] == "Approved continuation"
        assert isinstance(timeline_json, list) and any(item["type"] == "confirmation" for item in timeline_json)
        fake_find_agent_run_by_id.after_persist = True
        return completed_run

    async def fake_stream_openai_chat_completion(runtime_config, *, messages):
        assert runtime_config.model == "gpt-4o-mini"
        assert messages[-1]["content"].endswith("Please continue.")
        yield "Approved continuation"

    monkeypatch.setattr(agent_service, "find_active_provider_for_user", fake_find_active_provider_for_user)
    monkeypatch.setattr(agent_service, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    monkeypatch.setattr(agent_service, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)
    monkeypatch.setattr(agent_service, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    detail = await agent_service.confirm_agent_tool_record(
        object(),
        user_id,
        run_id,
        agent_service.PENDING_CONFIRMATION_TOOL_ID,
    )

    assert detail is not None
    assert detail.status == "completed"
    assert detail.requiresConfirmation is False
    assert detail.pendingToolCalls == []
    assert detail.finalText == "Approved continuation"
    assert detail.assistantTextChunks == ["Approved continuation"]
    assert detail.executedToolCalls[0].status == "completed"


@pytest.mark.asyncio
async def test_confirm_agent_tool_record_executes_supported_tool_before_continuation(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    session_id = uuid.uuid4()
    run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=uuid.uuid4(),
        session_id=session_id,
        status="waiting_confirmation",
        input_text="Create a task",
        model="gpt-4o-mini",
        messages_json=[
            {"id": "m1", "role": "user", "content": "Create a task", "createdAt": 1},
            {"id": "m2", "role": "assistant", "content": "I can do that after approval.", "createdAt": 2},
        ],
        pending_tool_calls_json=[
            {
                "id": "tool-1",
                "toolName": "create_task",
                "arguments": {"title": "Write migration report", "priority": "high"},
                "status": "waiting_confirmation",
                "requiresConfirmation": True,
                "result": {"confirmationMessage": "Please approve."},
                "createdAt": 3,
            }
        ],
        requires_confirmation=True,
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=timezone.utc),
        version=1,
    )
    completed_run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=run.user_id,
        session_id=session_id,
        status="completed",
        input_text="Create a task",
        model="gpt-4o-mini",
        created_at=run.created_at,
        updated_at=run.updated_at + timedelta(seconds=2),
        version=2,
    )

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == run_id
        return completed_run if fake_find_agent_run_by_id.after_persist else run
    fake_find_agent_run_by_id.after_persist = False

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

    async def fake_execute_pending_confirmation_tool(session, requested_user_id, pending_tool):
        del session
        assert requested_user_id == user_id
        assert pending_tool.toolName == "create_task"
        return agent_service.AgentRunToolExecutionDto(
            id=pending_tool.id,
            toolName=pending_tool.toolName,
            arguments=pending_tool.arguments,
            status="completed",
            requiresConfirmation=False,
            result={
                "id": "task-1",
                "title": "Write migration report",
                "completed": False,
                "priority": "high",
                "dueDate": None,
                "notes": None,
                "createdAt": 10,
                "updatedAt": 10,
                "version": 1,
            },
            createdAt=4,
        )

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
        assert requested_run_id == run_id
        assert status == "completed"
        assert requires_confirmation is False
        assert pending_tool_calls_json == []
        assert isinstance(executed_tool_calls_json, list) and executed_tool_calls_json[0]["toolName"] == "create_task"
        assert executed_tool_calls_json[0]["result"]["id"] == "task-1"
        assert assistant_text_chunks_json == ["Task created."]
        assert final_text == "Task created."
        assert iteration_count == 1
        assert isinstance(messages_json, list) and messages_json[-2]["role"] == "tool"
        assert "Tool create_task executed successfully" in messages_json[-2]["content"]
        assert isinstance(timeline_json, list) and any(item["type"] == "tool_start" for item in timeline_json)
        assert any(item["type"] == "tool_end" for item in timeline_json)
        fake_find_agent_run_by_id.after_persist = True
        return completed_run

    async def fake_stream_openai_chat_completion(runtime_config, *, messages):
        assert runtime_config.model == "gpt-4o-mini"
        assert "Tool create_task executed successfully" in messages[-1]["content"]
        assert "Write migration report" in messages[-1]["content"]
        yield "Task created."

    monkeypatch.setattr(agent_service, "find_active_provider_for_user", fake_find_active_provider_for_user)
    monkeypatch.setattr(agent_service, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    monkeypatch.setattr(agent_service, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)
    monkeypatch.setattr(agent_service, "_execute_pending_confirmation_tool", fake_execute_pending_confirmation_tool)
    monkeypatch.setattr(agent_service, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    detail = await agent_service.confirm_agent_tool_record(object(), user_id, run_id, "tool-1")

    assert detail is not None
    assert detail.status == "completed"
    assert detail.finalText == "Task created."
    assert detail.executedToolCalls[0].toolName == "create_task"
    assert detail.executedToolCalls[0].result["id"] == "task-1"
    assert detail.messages[-2].role == "tool"
    assert detail.messages[-1].content == "Task created."


@pytest.mark.asyncio
async def test_stream_confirm_agent_tool_record_emits_tokens_and_completion(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    session_id = uuid.uuid4()
    run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=uuid.uuid4(),
        session_id=session_id,
        status="waiting_confirmation",
        input_text="Approve the action",
        model="gpt-4o-mini",
        messages_json=[
            {"id": "m1", "role": "user", "content": "Approve the action", "createdAt": 1},
            {"id": "m2", "role": "assistant", "content": "I am waiting for approval.", "createdAt": 2},
        ],
        pending_tool_calls_json=[
            {
                "id": agent_service.PENDING_CONFIRMATION_TOOL_ID,
                "toolName": agent_service.PENDING_CONFIRMATION_TOOL_NAME,
                "arguments": {"inputText": "Approve the action"},
                "status": "waiting_confirmation",
                "requiresConfirmation": True,
                "result": {"confirmationMessage": "Please approve."},
                "createdAt": 3,
            }
        ],
        requires_confirmation=True,
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=timezone.utc),
        version=1,
    )
    completed_run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=run.user_id,
        session_id=session_id,
        status="completed",
        input_text="Approve the action",
        model="gpt-4o-mini",
        created_at=run.created_at,
        updated_at=run.updated_at + timedelta(seconds=2),
        version=2,
    )

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == run_id
        return completed_run if fake_find_agent_run_by_id.after_persist else run
    fake_find_agent_run_by_id.after_persist = False

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
        assert requested_run_id == run_id
        assert status == "completed"
        fake_find_agent_run_by_id.after_persist = True
        return completed_run

    async def fake_stream_openai_chat_completion(runtime_config, *, messages):
        del runtime_config, messages
        yield "Approved"
        yield " continuation"

    monkeypatch.setattr(agent_service, "find_active_provider_for_user", fake_find_active_provider_for_user)
    monkeypatch.setattr(agent_service, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    monkeypatch.setattr(agent_service, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)
    monkeypatch.setattr(agent_service, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    events = [
        event
        async for event in agent_service.stream_confirm_agent_tool_record(
            object(),
            user_id,
            run_id,
            agent_service.PENDING_CONFIRMATION_TOOL_ID,
        )
    ]

    assert events[0] == {
        "type": "metadata",
        "runId": run_id,
        "sessionId": str(session_id),
        "model": "gpt-4o-mini",
    }
    assert [event["token"] for event in events if event["type"] == "token"] == ["Approved", " continuation"]
    assert events[-1]["type"] == "run_completed"
    assert events[-1]["run"]["status"] == "completed"
    assert events[-1]["run"]["finalText"] == "Approved continuation"


@pytest.mark.asyncio
async def test_stream_confirm_agent_tool_record_returns_failed_run_when_tool_execution_fails(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    session_id = uuid.uuid4()
    run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=uuid.uuid4(),
        session_id=session_id,
        status="waiting_confirmation",
        input_text="Delete task",
        model="gpt-4o-mini",
        messages_json=[
            {"id": "m1", "role": "user", "content": "Delete task", "createdAt": 1},
            {"id": "m2", "role": "assistant", "content": "I need approval first.", "createdAt": 2},
        ],
        pending_tool_calls_json=[
            {
                "id": "tool-delete",
                "toolName": "delete_task",
                "arguments": {"id": str(uuid.uuid4())},
                "status": "waiting_confirmation",
                "requiresConfirmation": True,
                "result": {"confirmationMessage": "Please approve."},
                "createdAt": 3,
            }
        ],
        requires_confirmation=True,
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=timezone.utc),
        version=1,
    )
    failed_run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=run.user_id,
        session_id=session_id,
        status="failed",
        input_text="Delete task",
        model="gpt-4o-mini",
        created_at=run.created_at,
        updated_at=run.updated_at + timedelta(seconds=2),
        version=2,
    )

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == run_id
        return failed_run if fake_find_agent_run_by_id.after_persist else run
    fake_find_agent_run_by_id.after_persist = False

    async def fake_execute_pending_confirmation_tool(session, requested_user_id, pending_tool):
        del session
        assert requested_user_id == user_id
        return agent_service.AgentRunToolExecutionDto(
            id=pending_tool.id,
            toolName=pending_tool.toolName,
            arguments=pending_tool.arguments,
            status="failed",
            requiresConfirmation=False,
            errorMessage="Task not found.",
            createdAt=4,
        )

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
        del session, expected_version, messages_json, pending_tool_calls_json, assistant_text_chunks_json
        del timeline_json, final_text, iteration_count
        assert requested_user_id == user_id
        assert requested_run_id == run_id
        assert status == "failed"
        assert requires_confirmation is False
        assert error_text == "Task not found."
        assert isinstance(executed_tool_calls_json, list) and executed_tool_calls_json[0]["status"] == "failed"
        fake_find_agent_run_by_id.after_persist = True
        return failed_run

    async def fake_stream_provider_chat_completion(runtime_config, *, messages):
        del runtime_config, messages
        raise AssertionError("provider continuation should not run after tool failure")
        yield

    monkeypatch.setattr(agent_service, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)
    monkeypatch.setattr(agent_service, "_execute_pending_confirmation_tool", fake_execute_pending_confirmation_tool)
    monkeypatch.setattr(agent_service, "_stream_provider_chat_completion", fake_stream_provider_chat_completion)

    events = [
        event
        async for event in agent_service.stream_confirm_agent_tool_record(
            object(),
            user_id,
            run_id,
            "tool-delete",
        )
    ]

    assert events[0] == {
        "type": "metadata",
        "runId": run_id,
        "sessionId": str(session_id),
        "model": "gpt-4o-mini",
    }
    assert len([event for event in events if event["type"] == "token"]) == 0
    assert events[-1]["type"] == "run_completed"
    assert events[-1]["run"]["status"] == "failed"
    assert events[-1]["run"]["error"] == "Task not found."


@pytest.mark.asyncio
async def test_stream_confirm_agent_tool_record_supports_gemini_provider(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    session_id = uuid.uuid4()
    run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=uuid.uuid4(),
        session_id=session_id,
        status="waiting_confirmation",
        input_text="Approve the action",
        model="gemini-1.5-flash",
        messages_json=[
            {"id": "m1", "role": "user", "content": "Approve the action", "createdAt": 1},
            {"id": "m2", "role": "assistant", "content": "I am waiting for approval.", "createdAt": 2},
        ],
        pending_tool_calls_json=[
            {
                "id": agent_service.PENDING_CONFIRMATION_TOOL_ID,
                "toolName": agent_service.PENDING_CONFIRMATION_TOOL_NAME,
                "arguments": {"inputText": "Approve the action"},
                "status": "waiting_confirmation",
                "requiresConfirmation": True,
                "result": {"confirmationMessage": "Please approve."},
                "createdAt": 3,
            }
        ],
        requires_confirmation=True,
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=timezone.utc),
        version=1,
    )
    completed_run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=run.user_id,
        session_id=session_id,
        status="completed",
        input_text="Approve the action",
        model="gemini-1.5-flash",
        created_at=run.created_at,
        updated_at=run.updated_at + timedelta(seconds=2),
        version=2,
    )

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == run_id
        return completed_run if fake_find_agent_run_by_id.after_persist else run
    fake_find_agent_run_by_id.after_persist = False

    async def fake_find_active_provider_for_user(session, requested_user_id):
        del session
        assert requested_user_id == user_id
        return SimpleNamespace(
            id=uuid.uuid4(),
            name="Gemini Provider",
            api_format="gemini",
            base_url="https://generativelanguage.googleapis.com",
            api_key_encrypted="encrypted-secret",
            model="gemini-1.5-flash",
            headers_json={},
        )

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
        assert requested_run_id == run_id
        assert status == "completed"
        fake_find_agent_run_by_id.after_persist = True
        return completed_run

    async def fake_stream_gemini_generate_content(runtime_config, *, messages):
        assert runtime_config.api_format == "gemini"
        assert runtime_config.model == "gemini-1.5-flash"
        assert messages[-1]["content"].endswith("Please continue.")
        yield "Gemini"
        yield " continuation"

    monkeypatch.setattr(agent_service, "find_active_provider_for_user", fake_find_active_provider_for_user)
    monkeypatch.setattr(agent_service, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    monkeypatch.setattr(agent_service, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)
    monkeypatch.setattr(agent_service, "_stream_gemini_generate_content", fake_stream_gemini_generate_content)

    events = [
        event
        async for event in agent_service.stream_confirm_agent_tool_record(
            object(),
            user_id,
            run_id,
            agent_service.PENDING_CONFIRMATION_TOOL_ID,
        )
    ]

    assert events[0] == {
        "type": "metadata",
        "runId": run_id,
        "sessionId": str(session_id),
        "model": "gemini-1.5-flash",
    }
    assert [event["token"] for event in events if event["type"] == "token"] == ["Gemini", " continuation"]
    assert events[-1]["type"] == "run_completed"
    assert events[-1]["run"]["status"] == "completed"
    assert events[-1]["run"]["finalText"] == "Gemini continuation"


@pytest.mark.asyncio
async def test_reject_agent_tool_record_cancels_waiting_confirmation_run(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    session_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc)
    updated_at = created_at + timedelta(seconds=3)
    run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=uuid.uuid4(),
        session_id=session_id,
        status="waiting_confirmation",
        input_text="Approve the action",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=created_at,
        version=1,
    )
    cancelled_run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=run.user_id,
        session_id=session_id,
        status="cancelled",
        input_text="Approve the action",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=updated_at,
        version=2,
    )

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == run_id
        return run

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
        del session, expected_version, messages_json, pending_tool_calls_json, assistant_text_chunks_json
        del timeline_json, final_text, error_text, iteration_count, requires_confirmation
        assert requested_user_id == user_id
        assert requested_run_id == run_id
        assert status == "cancelled"
        assert isinstance(executed_tool_calls_json, list)
        return cancelled_run

    monkeypatch.setattr(agent_service, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)

    detail = await agent_service.reject_agent_tool_record(
        object(),
        user_id,
        run_id,
        agent_service.PENDING_CONFIRMATION_TOOL_ID,
    )

    assert detail is not None
    assert detail.status == "cancelled"
    assert detail.requiresConfirmation is False
    assert detail.pendingToolCalls == []
    assert len(detail.executedToolCalls) == 1
    assert detail.executedToolCalls[0].status == "failed"


@pytest.mark.asyncio
async def test_stream_reject_agent_tool_record_emits_metadata_and_completion(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    session_id = uuid.uuid4()
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=timezone.utc)
    updated_at = created_at + timedelta(seconds=3)
    run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=uuid.uuid4(),
        session_id=session_id,
        status="waiting_confirmation",
        input_text="Approve the action",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=created_at,
        version=1,
    )
    cancelled_run = AgentRun(
        id=uuid.UUID(run_id),
        user_id=run.user_id,
        session_id=session_id,
        status="cancelled",
        input_text="Approve the action",
        model="gpt-4o-mini",
        created_at=created_at,
        updated_at=updated_at,
        version=2,
    )

    async def fake_find_agent_run_by_id(session, requested_user_id, requested_run_id):
        del session
        assert requested_user_id == user_id
        assert requested_run_id == run_id
        return run

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
        del session, expected_version, messages_json, pending_tool_calls_json, assistant_text_chunks_json
        del timeline_json, final_text, error_text, iteration_count, requires_confirmation
        assert requested_user_id == user_id
        assert requested_run_id == run_id
        assert status == "cancelled"
        assert isinstance(executed_tool_calls_json, list)
        return cancelled_run

    monkeypatch.setattr(agent_service, "find_agent_run_by_id", fake_find_agent_run_by_id)
    monkeypatch.setattr(agent_service, "update_agent_run", fake_update_agent_run)

    events = [
        event
        async for event in agent_service.stream_reject_agent_tool_record(
            object(),
            user_id,
            run_id,
            agent_service.PENDING_CONFIRMATION_TOOL_ID,
        )
    ]

    assert events[0] == {
        "type": "metadata",
        "runId": run_id,
        "sessionId": str(session_id),
        "model": "gpt-4o-mini",
    }
    assert events[1]["type"] == "run_completed"
    assert events[1]["run"]["status"] == "cancelled"
