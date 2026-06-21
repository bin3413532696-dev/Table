from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.routes import knowledge_rag as knowledge_rag_routes
from app.core.csrf import CSRF_COOKIE_NAME, CSRF_HEADER_NAME, generate_csrf_token
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
async def test_non_health_get_sets_csrf_cookie(monkeypatch) -> None:
    app = _make_app()

    async def fake_get_stats(session, user_id):
        return {
            "documentCount": 0,
            "indexedDocumentCount": 0,
            "chunkCount": 0,
            "chunkWithEmbeddingCount": 0,
            "cacheCount": 0,
        }

    monkeypatch.setattr(knowledge_rag_routes, "get_stats", fake_get_stats)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/api/knowledge-rag/stats")

    assert response.status_code == 200
    assert CSRF_COOKIE_NAME in response.cookies


@pytest.mark.asyncio
async def test_corpora_endpoint_uses_route_service(monkeypatch) -> None:
    app = _make_app()

    async def fake_get_corpora(session, user_id):
        del session
        assert user_id == "00000000-0000-0000-0000-000000000001"
        return (
            [
                {
                    "id": "00000000-0000-0000-0000-000000000101",
                    "userId": user_id,
                    "name": "热力学教材",
                    "description": "个人资料集",
                    "defaultTags": ["热力学"],
                    "documentIds": ["00000000-0000-0000-0000-000000000201"],
                    "createdAt": 1,
                    "updatedAt": 2,
                }
            ],
            1,
        )

    monkeypatch.setattr(knowledge_rag_routes, "get_corpora", fake_get_corpora)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/api/knowledge-rag/corpora")

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["name"] == "热力学教材"


@pytest.mark.asyncio
async def test_search_endpoint_rejects_missing_csrf() -> None:
    app = _make_app()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post(
            "/api/knowledge-rag/search",
            json={"query": "budget", "mode": "hybrid", "limit": 5, "threshold": 0.2},
        )

    assert response.status_code == 403
    assert response.json() == {"error": "FORBIDDEN", "message": "CSRF token validation failed"}


@pytest.mark.asyncio
async def test_options_request_is_not_rejected_as_csrf() -> None:
    app = _make_app()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.options("/api/knowledge-rag/search")

    assert response.status_code != 403


@pytest.mark.asyncio
async def test_search_endpoint_uses_route_service(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()

    async def fake_search_service(session, user_id, payload, settings=None):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        assert payload.query == "budget"
        assert payload.mode == "hybrid"
        return {
            "results": [
                {
                    "id": "chunk-1",
                    "documentId": "doc-1",
                    "documentTitle": "Budget Planning",
                    "content": "budget planning and execution guidance",
                    "chunkIndex": 0,
                    "score": 0.91,
                    "source": "hybrid",
                    "sourceInfo": "integration.md",
                    "publishDate": None,
                    "sourceDept": "Finance",
                    "securityLevel": "internal",
                    "businessCategory": "planning",
                }
            ],
            "semanticCount": 1,
            "keywordCount": 1,
            "queryEmbeddingTimeMs": 4,
            "searchTimeMs": 9,
        }

    monkeypatch.setattr(knowledge_rag_routes, "search_service", fake_search_service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.post(
            "/api/knowledge-rag/search",
            json={"query": "budget", "mode": "hybrid", "limit": 5, "threshold": 0.2},
            headers={CSRF_HEADER_NAME: token},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["semanticCount"] == 1
    assert payload["keywordCount"] == 1
    assert payload["results"][0]["source"] == "hybrid"
    assert payload["results"][0]["documentTitle"] == "Budget Planning"


@pytest.mark.asyncio
async def test_backfill_endpoint_uses_route_service(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()
    document_id = "00000000-0000-0000-0000-000000000123"

    async def fake_backfill_embeddings_service(session, user_id, current_document_id, settings=None):
        assert user_id == "00000000-0000-0000-0000-000000000001"
        assert current_document_id == document_id
        return {"count": 2}

    monkeypatch.setattr(knowledge_rag_routes, "backfill_embeddings_service", fake_backfill_embeddings_service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.post(
            f"/api/knowledge-rag/documents/{document_id}/backfill",
            headers={CSRF_HEADER_NAME: token},
        )

    assert response.status_code == 200
    assert response.json() == {"count": 2}


@pytest.mark.asyncio
async def test_chunks_endpoint_reads_document_id_from_query(monkeypatch) -> None:
    app = _make_app()
    document_id = "00000000-0000-0000-0000-000000000123"

    async def fake_get_chunks(session, user_id, query):
        del session
        assert user_id == "00000000-0000-0000-0000-000000000001"
        assert query.documentId == document_id
        assert query.limit == 2
        assert query.offset == 0
        return (
            [
                {
                    "id": "00000000-0000-0000-0000-000000000901",
                    "documentId": document_id,
                    "userId": "00000000-0000-0000-0000-000000000001",
                    "content": "chunk body",
                    "contentHash": "chunk-hash",
                    "chunkIndex": 0,
                    "startPos": 0,
                    "endPos": 10,
                    "headingChain": None,
                    "headingLevel": None,
                    "embeddingDimensions": None,
                    "embeddingVersion": None,
                    "chunkType": "small",
                    "parentId": None,
                    "hasEmbedding": False,
                    "embeddingModel": None,
                    "createdAt": 1717200000000,
                    "updatedAt": 1717200000000,
                }
            ],
            1,
        )

    monkeypatch.setattr(knowledge_rag_routes, "get_chunks", fake_get_chunks)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get(f"/api/knowledge-rag/chunks?documentId={document_id}&limit=2")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["documentId"] == document_id
    assert payload["items"][0]["chunkIndex"] == 0


@pytest.mark.asyncio
async def test_jobs_endpoint_reads_query_params(monkeypatch) -> None:
    app = _make_app()
    document_id = "00000000-0000-0000-0000-000000000123"

    async def fake_get_jobs(session, user_id, query):
        del session
        assert user_id == "00000000-0000-0000-0000-000000000001"
        assert query.documentId == document_id
        assert query.limit == 2
        assert query.offset == 0
        return (
            [
                {
                    "id": "00000000-0000-0000-0000-000000000777",
                    "userId": "00000000-0000-0000-0000-000000000001",
                    "documentId": document_id,
                    "jobType": "full_index",
                    "status": "completed",
                    "progress": 100,
                    "error": None,
                    "startedAt": 1717200000000,
                    "completedAt": 1717200001000,
                    "createdAt": 1717200000000,
                }
            ],
            1,
        )

    monkeypatch.setattr(knowledge_rag_routes, "get_jobs", fake_get_jobs)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get(f"/api/knowledge-rag/jobs?documentId={document_id}&limit=2")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["documentId"] == document_id
    assert payload["items"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_trigger_index_endpoint_returns_conflict_payload_for_active_job(monkeypatch) -> None:
    app = _make_app()
    token = generate_csrf_token()
    document_id = "00000000-0000-0000-0000-000000000123"
    active_job = SimpleNamespace(
        id="00000000-0000-0000-0000-000000000777",
        document_id=document_id,
        status="running",
    )

    async def fake_trigger_index_service(session, user_id, current_document_id, payload, settings=None):
        del session, user_id, payload, settings
        assert current_document_id == document_id
        raise knowledge_rag_routes.IndexJobActiveError(active_job)

    monkeypatch.setattr(knowledge_rag_routes, "trigger_index_service", fake_trigger_index_service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(CSRF_COOKIE_NAME, token)
        response = await client.post(
            f"/api/knowledge-rag/documents/{document_id}/index",
            json={"force": True},
            headers={CSRF_HEADER_NAME: token},
        )

    assert response.status_code == 409
    assert response.json() == {
        "code": "index_job_active",
        "documentId": document_id,
        "jobId": "00000000-0000-0000-0000-000000000777",
        "jobStatus": "running",
        "message": "An indexing job is already active for this document.",
    }
