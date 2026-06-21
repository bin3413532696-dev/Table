from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

import app.services.agent._constants as agent_constants
import app.services.agent._provider as agent_provider
import app.services.agent._runs as agent_runs
import app.services.agent._sessions as agent_sessions
import app.services.agent._state as agent_state
import app.services.agent._tools as agent_tools
from app.db.models import AgentRun, AgentSession
from app.schemas.agent import CreateAgentRunRequest

from .agent_stream_test_helpers import patch_agent_symbol


def test_build_effective_system_prompt_blocks_tool_execution_for_explanations() -> None:
    prompt = agent_tools._build_effective_system_prompt("", rag_enabled=False)

    assert "如果用户是在询问如何使用某个工具" in prompt
    assert "不要调用任何工具" in prompt
    assert "create_task(title!, priority?, dueDate?, description?)" in prompt


def test_extract_stream_delta_text_supports_string_and_array_content() -> None:
    assert (
        agent_provider._extract_stream_delta_text(
            {"choices": [{"delta": {"content": "Hello"}}]}
        )
        == "Hello"
    )
    assert (
        agent_provider._extract_stream_delta_text(
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
        agent_provider._extract_anthropic_stream_delta_text(
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
        agent_provider._extract_gemini_stream_delta_text(
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
        created_at=datetime(2026, 5, 31, 8, 0, tzinfo=UTC),
        updated_at=datetime(2026, 5, 31, 8, 1, tzinfo=UTC),
        version=1,
    )

    detail = agent_state._to_agent_run_detail(run)

    assert detail.status == "waiting_confirmation"
    assert detail.requiresConfirmation is True
    assert len(detail.pendingToolCalls) == 1
    pending_tool = detail.pendingToolCalls[0]
    assert pending_tool.id == agent_constants.PENDING_CONFIRMATION_TOOL_ID
    assert pending_tool.toolName == agent_constants.PENDING_CONFIRMATION_TOOL_NAME
    assert pending_tool.status == "waiting_confirmation"


@pytest.mark.asyncio
async def test_get_agent_runtime_status_serializes_provider_uuid_id(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    provider_id = uuid.uuid4()
    provider = SimpleNamespace(
        id=provider_id,
        name="Primary Provider",
        api_format="openai",
        base_url="https://provider.example.com",
        api_key_encrypted="encrypted-secret",
        model="gpt-4o-mini",
    )

    async def fake_find_active_provider_for_user(session, requested_user_id):
        del session
        assert requested_user_id == user_id
        return provider

    patch_agent_symbol(monkeypatch, "find_active_provider_for_user", fake_find_active_provider_for_user)

    result = await agent_sessions.get_agent_runtime_status(object(), user_id)

    assert result.ok is True
    assert result.runtime.provider is not None
    assert result.runtime.provider.id == str(provider_id)
    assert isinstance(result.runtime.provider.id, str)


@pytest.mark.asyncio
async def test_get_agent_session_detail_aggregates_persisted_run_messages(monkeypatch) -> None:
    user_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    session_uuid = uuid.UUID(session_id)
    created_at = datetime(2026, 5, 31, 8, 0, tzinfo=UTC)
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

    patch_agent_symbol(monkeypatch, "find_agent_session_by_id", fake_find_agent_session_by_id)
    patch_agent_symbol(monkeypatch, "list_runs_for_session", fake_list_runs_for_session)

    detail = await agent_sessions.get_agent_session_detail(object(), user_id, session_id)

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

    patch_agent_symbol(monkeypatch, "stream_agent_run_record", fake_stream_agent_run_record)

    detail = await agent_runs.create_agent_run_record(object(), user_id, payload)

    assert detail.status == "completed"
    assert detail.finalText == "Done"
