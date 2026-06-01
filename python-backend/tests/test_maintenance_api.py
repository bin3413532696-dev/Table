import pytest
from httpx import ASGITransport, AsyncClient

from app.api.routes import maintenance as maintenance_routes
from app.core.csrf import CSRF_COOKIE_NAME, CSRF_HEADER_NAME, generate_csrf_token
from app.core.user_context import UserContext
from app.db.session import get_session
from app.dependencies import get_authenticated_user
from app.main import create_app


def _make_app(*, user_id: str = "00000000-0000-0000-0000-000000000001"):
    app = create_app()

    async def fake_get_session():
        yield object()

    async def fake_get_authenticated_user():
        return UserContext(user_id=user_id, source="default")

    app.dependency_overrides[get_session] = fake_get_session
    app.dependency_overrides[get_authenticated_user] = fake_get_authenticated_user
    return app


@pytest.mark.asyncio
async def test_export_business_snapshot_route_uses_service(monkeypatch) -> None:
    app = _make_app()

    async def fake_export_business_snapshot(session, user_id):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        return {
            "version": 1,
            "exportedAt": "2026-05-31T00:00:00+00:00",
            "tasks": [],
            "finance": [],
            "knowledge": {
                "notes": [],
                "presetTags": [],
            },
        }

    monkeypatch.setattr(maintenance_routes, "export_business_snapshot", fake_export_business_snapshot)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/api/maintenance/business-snapshot")

    assert response.status_code == 200
    assert response.json()["version"] == 1


@pytest.mark.asyncio
async def test_import_business_snapshot_route_uses_service(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_import_business_snapshot(session, user_id, payload):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        assert payload.tasks == [{"title": "Task A", "completed": False, "priority": "medium"}]
        return {
            "success": True,
            "importedAt": "2026-05-31T00:00:00+00:00",
            "backup": {
                "version": 1,
                "exportedAt": "2026-05-30T00:00:00+00:00",
                "tasks": [],
                "finance": [],
                "knowledge": {"notes": [], "presetTags": []},
            },
            "tasks": 1,
            "finance": 0,
            "notes": 0,
            "presetTags": 0,
        }

    monkeypatch.setattr(maintenance_routes, "import_business_snapshot", fake_import_business_snapshot)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.post(
            "/api/maintenance/business-snapshot",
            headers={CSRF_HEADER_NAME: token},
            json={"tasks": [{"title": "Task A", "completed": False, "priority": "medium"}]},
        )

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert response.json()["tasks"] == 1


@pytest.mark.asyncio
async def test_reset_workspace_route_requires_default_user() -> None:
    app = _make_app(user_id="00000000-0000-0000-0000-000000000099")
    token = generate_csrf_token()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.post(
            "/api/maintenance/reset",
            headers={CSRF_HEADER_NAME: token},
            json={"scope": "all"},
        )

    assert response.status_code == 403
    assert response.json() == {
        "error": "FORBIDDEN",
        "message": "Only default user can access maintenance operations",
    }
