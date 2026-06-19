from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.agent.registry import AgentToolExecutionContext
from app.services.agent.tools import rag as rag_tools


@pytest.mark.asyncio
async def test_rag_answer_uses_session_corpus_documents_when_document_ids_not_explicit(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_resolve_session_corpus_id(session, user_id, *, session_id):
        del session, user_id
        assert session_id == "session-1"
        return "corpus-1"

    async def fake_resolve_corpus_document_ids(session, user_id, *, corpus_id):
        del session, user_id
        assert corpus_id == "corpus-1"
        return ["doc-1", "doc-2"]

    async def fake_search_service(session, user_id, payload, settings=None):
        del session, user_id, settings
        captured["document_ids"] = payload.documentIds
        return SimpleNamespace(results=[])

    monkeypatch.setattr(rag_tools, "resolve_session_corpus_id", fake_resolve_session_corpus_id)
    monkeypatch.setattr(rag_tools, "resolve_corpus_document_ids", fake_resolve_corpus_document_ids)
    monkeypatch.setattr(rag_tools, "search_service", fake_search_service)

    context = AgentToolExecutionContext(
        session=object(),
        user_id="00000000-0000-0000-0000-000000000001",
        settings=SimpleNamespace(
            query_preprocessor_enabled=False,
            reranker_enabled=False,
            mmr_enabled=False,
        ),
    )

    result = await rag_tools._rag_answer(
        context,
        {
            "question": "解释熵增原理",
            "limit": 5,
            "_sessionId": "session-1",
        },
    )

    assert captured["document_ids"] == ["doc-1", "doc-2"]
    assert result["searched"] is True
