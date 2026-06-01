import pytest
from httpx import ASGITransport, AsyncClient

from app.api.routes import providers as provider_routes
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
async def test_list_providers_uses_route_service(monkeypatch) -> None:
    app = _make_app()

    async def fake_list_providers_service(session, user_id):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        return []

    monkeypatch.setattr(provider_routes, "list_providers_service", fake_list_providers_service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/api/providers")

    assert response.status_code == 200
    assert CSRF_COOKIE_NAME in response.cookies
    assert response.json() == {"data": {"items": [], "total": 0}}


@pytest.mark.asyncio
async def test_create_provider_uses_route_service(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_create_provider_service(session, user_id, payload):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        assert payload.name == "Primary Provider"
        return {
            "id": "00000000-0000-0000-0000-000000000123",
            "name": "Primary Provider",
            "apiFormat": "openai",
            "baseUrl": "https://provider.example.com",
            "apiKey": "",
            "model": "gpt-4o-mini",
            "embeddingModel": "text-embedding-3-small",
            "rerankerModel": "rerank-v3",
            "headers": {"X-Test": "1"},
            "isActive": True,
            "hasApiKey": True,
            "apiKeyPreview": "••••••••1234",
            "source": "manual",
            "createdAt": "2026-05-31T00:00:00+00:00",
            "updatedAt": "2026-05-31T00:00:00+00:00",
            "version": 1,
        }

    monkeypatch.setattr(provider_routes, "create_provider_service", fake_create_provider_service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.post(
            "/api/providers",
            headers={CSRF_HEADER_NAME: token},
            json={
                "name": "Primary Provider",
                "apiFormat": "openai",
                "baseUrl": "https://provider.example.com",
                "apiKey": "secret-token",
                "model": "gpt-4o-mini",
                "embeddingModel": "text-embedding-3-small",
                "rerankerModel": "rerank-v3",
                "headers": {"X-Test": "1"},
                "isActive": True,
            },
        )

    assert response.status_code == 201
    assert response.json()["data"]["provider"]["name"] == "Primary Provider"


@pytest.mark.asyncio
async def test_update_provider_propagates_version_conflict(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_update_provider_service(session, user_id, provider_id, payload):
        raise VersionConflictError("Provider was modified by another request. Please refresh and try again.")

    monkeypatch.setattr(provider_routes, "update_provider_service", fake_update_provider_service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.patch(
            "/api/providers/00000000-0000-0000-0000-000000000123",
            headers={CSRF_HEADER_NAME: token},
            json={"name": "Updated Provider", "version": 1},
        )

    assert response.status_code == 409
    assert response.json() == {
        "error": "VERSION_CONFLICT",
        "message": "Provider was modified by another request. Please refresh and try again.",
    }
