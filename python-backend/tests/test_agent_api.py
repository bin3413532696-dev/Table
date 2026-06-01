import pytest
from httpx import ASGITransport, AsyncClient

from app.api.routes import agent as agent_routes
from app.core.csrf import CSRF_COOKIE_NAME, CSRF_HEADER_NAME, generate_csrf_token
from app.core.errors import VersionConflictError
from app.core.user_context import UserContext
from app.db.session import get_session
from app.dependencies import get_authenticated_user
from app.main import create_app


def _make_app():
    app = create_app()

    async def fake_get_session():
        yield object()

    async def fake_get_authenticated_user():
        return UserContext(
            user_id="00000000-0000-0000-0000-000000000001",
            source="default",
        )

    app.dependency_overrides[get_session] = fake_get_session
    app.dependency_overrides[get_authenticated_user] = fake_get_authenticated_user
    return app


@pytest.mark.asyncio
async def test_agent_health_uses_route_service(monkeypatch) -> None:
    app = _make_app()

    async def fake_get_agent_runtime_status(session, user_id):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        return {
            "ok": True,
            "module": "agent",
            "stage": "persistence-v1",
            "runtime": {
                "connected": True,
                "selectedModel": "gpt-4o-mini",
                "availableModels": ["gpt-4o-mini"],
                "provider": {
                    "id": "00000000-0000-0000-0000-000000000123",
                    "name": "Primary Provider",
                    "apiFormat": "openai",
                    "baseUrl": "https://provider.example.com",
                    "hasApiKey": True,
                },
            },
        }

    monkeypatch.setattr(agent_routes, "get_agent_runtime_status", fake_get_agent_runtime_status)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/api/agent/health")

    assert response.status_code == 200
    assert CSRF_COOKIE_NAME in response.cookies
    assert response.json()["runtime"]["selectedModel"] == "gpt-4o-mini"


@pytest.mark.asyncio
async def test_fetch_agent_persona_uses_route_service(monkeypatch) -> None:
    app = _make_app()

    async def fake_get_agent_persona(session, user_id):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        return {"systemPrompt": "You are concise."}

    monkeypatch.setattr(agent_routes, "get_agent_persona", fake_get_agent_persona)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/api/agent/persona")

    assert response.status_code == 200
    assert response.json() == {"systemPrompt": "You are concise."}


@pytest.mark.asyncio
async def test_update_agent_persona_requires_csrf() -> None:
    app = _make_app()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.put("/api/agent/persona", json={"systemPrompt": "test"})

    assert response.status_code == 403
    assert response.json() == {"error": "FORBIDDEN", "message": "CSRF token validation failed"}


@pytest.mark.asyncio
async def test_list_agent_sessions_uses_route_service(monkeypatch) -> None:
    app = _make_app()

    async def fake_get_agent_session_list(session, user_id, query):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        assert query.limit == 10
        return (
            [
                {
                    "id": "00000000-0000-0000-0000-000000000101",
                    "title": "Session A",
                    "createdAt": 1,
                    "updatedAt": 2,
                    "runs": [],
                }
            ],
            1,
        )

    monkeypatch.setattr(agent_routes, "get_agent_session_list", fake_get_agent_session_list)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/api/agent/sessions?limit=10")

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["title"] == "Session A"


@pytest.mark.asyncio
async def test_create_agent_run_uses_route_service(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_create_agent_run_record(session, user_id, payload):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        assert payload.inputText == "Review the migration plan"
        return {
            "id": "00000000-0000-0000-0000-000000000201",
            "sessionId": "00000000-0000-0000-0000-000000000101",
            "status": "pending",
            "inputText": payload.inputText,
            "model": "default",
            "createdAt": 10,
            "updatedAt": 10,
            "version": 1,
            "messages": [],
            "executedToolCalls": [],
            "pendingToolCalls": [],
            "requiresConfirmation": False,
            "finalText": "",
            "error": None,
            "iterationCount": 0,
            "assistantTextChunks": [],
            "timeline": [],
        }

    monkeypatch.setattr(agent_routes, "create_agent_run_record", fake_create_agent_run_record)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.post(
            "/api/agent/runs",
            headers={CSRF_HEADER_NAME: token},
            json={"inputText": "Review the migration plan", "model": "default"},
        )

    assert response.status_code == 201
    assert response.json()["status"] == "pending"


@pytest.mark.asyncio
async def test_stream_agent_run_route_emits_sse_events(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_stream_agent_run_record(session, user_id, payload):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        assert payload.inputText == "Review the migration plan"
        yield {
            "type": "metadata",
            "runId": "00000000-0000-0000-0000-000000000201",
            "sessionId": "00000000-0000-0000-0000-000000000101",
            "model": "gpt-4o-mini",
        }
        yield {
            "type": "token",
            "token": "Hello",
        }
        yield {
            "type": "run_completed",
            "run": {
                "id": "00000000-0000-0000-0000-000000000201",
                "sessionId": "00000000-0000-0000-0000-000000000101",
                "status": "completed",
                "inputText": payload.inputText,
                "model": "gpt-4o-mini",
                "createdAt": 10,
                "updatedAt": 11,
                "version": 2,
                "messages": [
                    {
                        "id": "assistant-message",
                        "role": "assistant",
                        "content": "Hello",
                        "createdAt": 11,
                    }
                ],
                "executedToolCalls": [],
                "pendingToolCalls": [],
                "requiresConfirmation": False,
                "finalText": "Hello",
                "error": None,
                "iterationCount": 1,
                "assistantTextChunks": ["Hello"],
                "timeline": [],
            },
        }

    monkeypatch.setattr(agent_routes, "stream_agent_run_record", fake_stream_agent_run_record)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        async with client.stream(
            "POST",
            "/api/agent/runs/stream",
            headers={CSRF_HEADER_NAME: token},
            json={"inputText": "Review the migration plan", "model": "default"},
        ) as response:
            body = ""
            async for chunk in response.aiter_text():
                body += chunk

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: metadata" in body
    assert '"runId": "00000000-0000-0000-0000-000000000201"' in body
    assert "event: token" in body
    assert '"token": "Hello"' in body
    assert "event: run_completed" in body
    assert "event: done" in body


@pytest.mark.asyncio
async def test_stream_agent_run_route_emits_error_event(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_stream_agent_run_record(session, user_id, payload):
        del session, user_id, payload
        raise RuntimeError("Provider request failed")
        yield

    monkeypatch.setattr(agent_routes, "stream_agent_run_record", fake_stream_agent_run_record)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        async with client.stream(
            "POST",
            "/api/agent/runs/stream",
            headers={CSRF_HEADER_NAME: token},
            json={"inputText": "Review the migration plan", "model": "default"},
        ) as response:
            body = ""
            async for chunk in response.aiter_text():
                body += chunk

    assert response.status_code == 200
    assert "event: error" in body
    assert '"message": "Provider request failed"' in body


@pytest.mark.asyncio
async def test_confirm_agent_tool_route_returns_run_detail(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_confirm_agent_tool_record(session, user_id, run_id, tool_execution_id):
        del session, user_id
        assert tool_execution_id == "pending-confirmation"
        return {
            "id": run_id,
            "sessionId": "00000000-0000-0000-0000-000000000101",
            "status": "completed",
            "inputText": "Review the migration plan",
            "model": "gpt-4o-mini",
            "createdAt": 10,
            "updatedAt": 11,
            "version": 2,
            "messages": [],
            "executedToolCalls": [],
            "pendingToolCalls": [],
            "requiresConfirmation": False,
            "finalText": "Approved continuation",
            "error": None,
            "iterationCount": 2,
            "assistantTextChunks": ["Approved continuation"],
            "timeline": [],
        }

    monkeypatch.setattr(agent_routes, "confirm_agent_tool_record", fake_confirm_agent_tool_record)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.post(
            "/api/agent/runs/00000000-0000-0000-0000-000000000201/tools/pending-confirmation/confirm",
            headers={CSRF_HEADER_NAME: token},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    assert response.json()["finalText"] == "Approved continuation"


@pytest.mark.asyncio
async def test_confirm_agent_tool_stream_route_emits_sse_events(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_stream_confirm_agent_tool_record(session, user_id, run_id, tool_execution_id):
        del session, user_id
        assert tool_execution_id == "pending-confirmation"
        yield {
            "type": "metadata",
            "runId": run_id,
            "sessionId": "00000000-0000-0000-0000-000000000101",
            "model": "gpt-4o-mini",
        }
        yield {
            "type": "token",
            "token": "Approved",
        }
        yield {
            "type": "run_completed",
            "run": {
                "id": run_id,
                "sessionId": "00000000-0000-0000-0000-000000000101",
                "status": "completed",
                "inputText": "Review the migration plan",
                "model": "gpt-4o-mini",
                "createdAt": 10,
                "updatedAt": 11,
                "version": 2,
                "messages": [],
                "executedToolCalls": [],
                "pendingToolCalls": [],
                "requiresConfirmation": False,
                "finalText": "Approved continuation",
                "error": None,
                "iterationCount": 2,
                "assistantTextChunks": ["Approved continuation"],
                "timeline": [],
            },
        }

    monkeypatch.setattr(agent_routes, "stream_confirm_agent_tool_record", fake_stream_confirm_agent_tool_record)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        async with client.stream(
            "POST",
            "/api/agent/runs/00000000-0000-0000-0000-000000000201/tools/pending-confirmation/confirm/stream",
            headers={CSRF_HEADER_NAME: token},
        ) as response:
            body = ""
            async for chunk in response.aiter_text():
                body += chunk

    assert response.status_code == 200
    assert "event: metadata" in body
    assert "event: token" in body
    assert '"token": "Approved"' in body
    assert "event: run_completed" in body
    assert "event: done" in body


@pytest.mark.asyncio
async def test_reject_agent_tool_stream_route_emits_sse_events(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_stream_reject_agent_tool_record(session, user_id, run_id, tool_execution_id):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        assert tool_execution_id == "pending-confirmation"
        yield {
            "type": "metadata",
            "runId": run_id,
            "sessionId": "00000000-0000-0000-0000-000000000101",
            "model": "gpt-4o-mini",
        }
        yield {
            "type": "run_completed",
            "run": {
                "id": run_id,
                "sessionId": "00000000-0000-0000-0000-000000000101",
                "status": "cancelled",
                "inputText": "Review the migration plan",
                "model": "gpt-4o-mini",
                "createdAt": 10,
                "updatedAt": 11,
                "version": 2,
                "messages": [],
                "executedToolCalls": [],
                "pendingToolCalls": [],
                "requiresConfirmation": False,
                "finalText": "",
                "error": None,
                "iterationCount": 0,
                "assistantTextChunks": [],
                "timeline": [],
            },
        }

    monkeypatch.setattr(agent_routes, "stream_reject_agent_tool_record", fake_stream_reject_agent_tool_record)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        async with client.stream(
            "POST",
            "/api/agent/runs/00000000-0000-0000-0000-000000000201/tools/pending-confirmation/reject/stream",
            headers={CSRF_HEADER_NAME: token},
        ) as response:
            body = ""
            async for chunk in response.aiter_text():
                body += chunk

    assert response.status_code == 200
    assert "event: metadata" in body
    assert "event: run_completed" in body
    assert '"status": "cancelled"' in body
    assert "event: done" in body


@pytest.mark.asyncio
async def test_delete_agent_run_converts_active_conflict(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_delete_agent_run_record(session, user_id, run_id):
        raise ValueError("Cannot delete an agent run while it is still active.")

    monkeypatch.setattr(agent_routes, "delete_agent_run_record", fake_delete_agent_run_record)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.delete(
            "/api/agent/runs/00000000-0000-0000-0000-000000000201",
            headers={CSRF_HEADER_NAME: token},
        )

    assert response.status_code == 409
    assert response.json() == {
        "error": "CONFLICT",
        "message": "Cannot delete an agent run while it is still active.",
    }


@pytest.mark.asyncio
async def test_patch_agent_run_propagates_version_conflict(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_update_agent_run_record(session, user_id, run_id, payload):
        raise VersionConflictError("Agent run was modified by another request. Please refresh and try again.")

    monkeypatch.setattr(agent_routes, "update_agent_run_record", fake_update_agent_run_record)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.patch(
            "/api/agent/runs/00000000-0000-0000-0000-000000000201",
            headers={CSRF_HEADER_NAME: token},
            json={"status": "completed", "version": 1},
        )

    assert response.status_code == 409
    assert response.json() == {
        "error": "VERSION_CONFLICT",
        "message": "Agent run was modified by another request. Please refresh and try again.",
    }
