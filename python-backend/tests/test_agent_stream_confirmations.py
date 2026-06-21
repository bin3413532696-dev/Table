from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

import app.services.agent._confirmations as agent_confirmations
import app.services.agent._constants as agent_constants
from app.db.models import AgentRun
from app.schemas.agent import AgentRunToolExecutionDto

from .agent_stream_test_helpers import patch_agent_symbol


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
                "id": agent_constants.PENDING_CONFIRMATION_TOOL_ID,
                "toolName": agent_constants.PENDING_CONFIRMATION_TOOL_NAME,
                "arguments": {"inputText": "Approve the action"},
                "status": "waiting_confirmation",
                "requiresConfirmation": True,
                "result": {"confirmationMessage": "Please approve."},
                "createdAt": 3,
            }
        ],
        requires_confirmation=True,
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=UTC),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=UTC),
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

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)
    patch_agent_symbol(monkeypatch, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    detail = await agent_confirmations.confirm_agent_tool_record(
        object(),
        user_id,
        run_id,
        agent_constants.PENDING_CONFIRMATION_TOOL_ID,
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
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=UTC),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=UTC),
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
        return AgentRunToolExecutionDto(
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

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)
    patch_agent_symbol(monkeypatch, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "_execute_pending_confirmation_tool", fake_execute_pending_confirmation_tool)
    patch_agent_symbol(monkeypatch, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    detail = await agent_confirmations.confirm_agent_tool_record(object(), user_id, run_id, "tool-1")

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
                "id": agent_constants.PENDING_CONFIRMATION_TOOL_ID,
                "toolName": agent_constants.PENDING_CONFIRMATION_TOOL_NAME,
                "arguments": {"inputText": "Approve the action"},
                "status": "waiting_confirmation",
                "requiresConfirmation": True,
                "result": {"confirmationMessage": "Please approve."},
                "createdAt": 3,
            }
        ],
        requires_confirmation=True,
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=UTC),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=UTC),
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

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)
    patch_agent_symbol(monkeypatch, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "_stream_openai_chat_completion", fake_stream_openai_chat_completion)

    events = [
        event
        async for event in agent_confirmations.stream_confirm_agent_tool_record(
            object(),
            user_id,
            run_id,
            agent_constants.PENDING_CONFIRMATION_TOOL_ID,
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
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=UTC),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=UTC),
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
        return AgentRunToolExecutionDto(
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

    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "_execute_pending_confirmation_tool", fake_execute_pending_confirmation_tool)
    patch_agent_symbol(monkeypatch, "_stream_provider_chat_completion", fake_stream_provider_chat_completion)

    events = [
        event
        async for event in agent_confirmations.stream_confirm_agent_tool_record(
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
                "id": agent_constants.PENDING_CONFIRMATION_TOOL_ID,
                "toolName": agent_constants.PENDING_CONFIRMATION_TOOL_NAME,
                "arguments": {"inputText": "Approve the action"},
                "status": "waiting_confirmation",
                "requiresConfirmation": True,
                "result": {"confirmationMessage": "Please approve."},
                "createdAt": 3,
            }
        ],
        requires_confirmation=True,
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=UTC),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=UTC),
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

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)
    patch_agent_symbol(monkeypatch, "decrypt_provider_secret", lambda value, settings=None: "plain-secret")
    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)
    patch_agent_symbol(monkeypatch, "_stream_gemini_generate_content", fake_stream_gemini_generate_content)

    events = [
        event
        async for event in agent_confirmations.stream_confirm_agent_tool_record(
            object(),
            user_id,
            run_id,
            agent_constants.PENDING_CONFIRMATION_TOOL_ID,
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
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=UTC)
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

    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)

    detail = await agent_confirmations.reject_agent_tool_record(
        object(),
        user_id,
        run_id,
        agent_constants.PENDING_CONFIRMATION_TOOL_ID,
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
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=UTC)
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

    patch_agent_symbol(monkeypatch, "find_agent_run_by_id", fake_find_agent_run_by_id)
    patch_agent_symbol(monkeypatch, "update_agent_run", fake_update_agent_run)

    events = [
        event
        async for event in agent_confirmations.stream_reject_agent_tool_record(
            object(),
            user_id,
            run_id,
            agent_constants.PENDING_CONFIRMATION_TOOL_ID,
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
