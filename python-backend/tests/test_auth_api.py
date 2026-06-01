import pytest
from httpx import ASGITransport, AsyncClient

from app.api.routes import auth as auth_routes
from app.core.csrf import CSRF_COOKIE_NAME, CSRF_HEADER_NAME, generate_csrf_token
from app.core.user_context import DEV_SESSION_COOKIE, UserContext
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
async def test_auth_me_uses_route_service(monkeypatch) -> None:
    app = _make_app()

    async def fake_get_auth_me(session, user, settings):
        assert user.user_id == "00000000-0000-0000-0000-000000000001"
        return {
            "data": {
                "user": {
                    "id": user.user_id,
                    "displayName": "Default Local User",
                    "email": None,
                    "status": "active",
                    "bio": "",
                    "createdAt": "2026-05-31T00:00:00+00:00",
                    "updatedAt": "2026-05-31T00:00:00+00:00",
                },
                "auth": {
                    "userIdHeader": "x-user-id",
                    "source": "default",
                    "isDefaultUser": True,
                    "devSessionCookie": DEV_SESSION_COOKIE,
                },
            }
        }

    monkeypatch.setattr(auth_routes, "get_auth_me", fake_get_auth_me)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/api/auth/me")

    assert response.status_code == 200
    assert CSRF_COOKIE_NAME in response.cookies
    assert response.json()["data"]["user"]["displayName"] == "Default Local User"


@pytest.mark.asyncio
async def test_switch_auth_session_sets_signed_cookie(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_get_session_target_user(session, user_id):
        assert user_id == "00000000-0000-0000-0000-000000000002"
        return {
            "id": user_id,
            "displayName": "Second User",
            "email": None,
            "status": "active",
            "bio": "",
            "createdAt": "2026-05-31T00:00:00+00:00",
            "updatedAt": "2026-05-31T00:00:00+00:00",
        }

    monkeypatch.setattr(auth_routes, "get_session_target_user", fake_get_session_target_user)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.post(
            "/api/auth/session",
            headers={CSRF_HEADER_NAME: token},
            json={"userId": "00000000-0000-0000-0000-000000000002"},
        )

    assert response.status_code == 200
    set_cookie_headers = response.headers.get_list("set-cookie")
    assert any(header.startswith(f"{DEV_SESSION_COOKIE}=") for header in set_cookie_headers)
    assert response.json()["data"]["auth"]["source"] == "signed_session"


@pytest.mark.asyncio
async def test_clear_auth_session_clears_cookie(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_clear_auth_session_target(session, settings):
        return {
            "id": settings.default_user_id,
            "displayName": "Default Local User",
            "email": None,
            "status": "active",
            "bio": "",
            "createdAt": "2026-05-31T00:00:00+00:00",
            "updatedAt": "2026-05-31T00:00:00+00:00",
        }

    monkeypatch.setattr(auth_routes, "clear_auth_session_target", fake_clear_auth_session_target)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.delete(
            "/api/auth/session",
            headers={CSRF_HEADER_NAME: token},
        )

    assert response.status_code == 200
    set_cookie_headers = response.headers.get_list("set-cookie")
    assert any(f"{DEV_SESSION_COOKIE}=" in header and "Max-Age=0" in header for header in set_cookie_headers)


@pytest.mark.asyncio
async def test_verify_pin_sets_session_and_csrf_cookies(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_verify_pin_code(session, user_id, payload):
        assert payload.pin == "1234"
        return {"valid": True}

    monkeypatch.setattr(auth_routes, "verify_pin_code", fake_verify_pin_code)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.post(
            "/api/auth/pin/verify",
            headers={CSRF_HEADER_NAME: token},
            json={"pin": "1234"},
        )

    assert response.status_code == 200
    set_cookie_headers = response.headers.get_list("set-cookie")
    assert any(header.startswith(f"{DEV_SESSION_COOKIE}=") for header in set_cookie_headers)
    assert any(header.startswith(f"{CSRF_COOKIE_NAME}=") for header in set_cookie_headers)
    assert response.json() == {"valid": True}
