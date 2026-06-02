from types import SimpleNamespace

import pytest

from app.services import agent as agent_service
from app.core.config import Settings
from app.schemas.knowledge_rag import SearchResultResponse
from app.services.agent.registry import AgentToolExecutionContext
from app.services.agent.tools import rag as rag_tools


def _context() -> AgentToolExecutionContext:
    return AgentToolExecutionContext(
        session=object(),
        user_id="00000000-0000-0000-0000-000000000001",
        settings=Settings(
            database_url="postgresql://user:pass@localhost:5432/table",
            reranker_enabled=True,
        ),
    )


@pytest.mark.asyncio
async def test_search_knowledge_rag_uses_search_with_context_service(monkeypatch) -> None:
    context = _context()

    async def fake_search_with_context_service(session, user_id, payload, settings=None):
        assert session is context.session
        assert user_id == context.user_id
        assert payload.query == "transformer"
        assert payload.mode == "semantic"
        assert payload.enableRerank is True
        return {"context": "[Doc] parent", "results": [{"id": "c1"}], "message": "ok"}

    monkeypatch.setattr(rag_tools, "search_with_context_service", fake_search_with_context_service)

    result = await rag_tools._search_knowledge_rag(context, {"query": "transformer", "limit": 3})
    assert result["context"] == "[Doc] parent"
    assert result["message"] == "ok"


@pytest.mark.asyncio
async def test_rag_answer_returns_deduplicated_parent_context_and_sources(monkeypatch) -> None:
    context = _context()
    results = [
        SearchResultResponse(
            id="c1",
            documentId="d1",
            documentTitle="Doc",
            content="child one",
            parentChunkId="p1",
            parentContent="parent context",
            chunkIndex=0,
            score=0.9,
            source="reranked",
            sourceInfo=None,
        ),
        SearchResultResponse(
            id="c2",
            documentId="d1",
            documentTitle="Doc",
            content="child two",
            parentChunkId="p1",
            parentContent="parent context",
            chunkIndex=1,
            score=0.8,
            source="semantic",
            sourceInfo=None,
        ),
    ]

    async def fake_search_service(session, user_id, payload, settings=None):
        assert session is context.session
        assert user_id == context.user_id
        assert payload.query == "什么是 Transformer"
        return SimpleNamespace(results=results)

    monkeypatch.setattr(rag_tools, "search_service", fake_search_service)

    result = await rag_tools._rag_answer(context, {"question": "什么是 Transformer", "limit": 2})
    assert result["searched"] is True
    assert result["sources"][0]["chunkId"] == "c1"
    assert result["sources"][1]["chunkId"] == "c2"
    assert result["context"].count("[Doc]") == 1
    assert "parent context" in result["context"]


@pytest.mark.asyncio
async def test_chunk_read_prefers_parent_content(monkeypatch) -> None:
    context = _context()

    async def fake_get_rag_chunk_by_id(session, user_id, chunk_id):
        assert session is context.session
        assert user_id == context.user_id
        assert chunk_id == "c1"
        return {
            "id": "c1",
            "parent_id": "p1",
            "document_title": "Doc",
            "heading_chain": None,
            "content": "child content",
            "parent_content": "parent content",
        }

    monkeypatch.setattr(rag_tools, "get_rag_chunk_by_id", fake_get_rag_chunk_by_id)

    result = await rag_tools._chunk_read(context, {"chunkId": "c1"})
    assert "<parent_chunk_id>p1</parent_chunk_id>" in result
    assert "<content>parent content</content>" in result


def test_parse_tool_calls_strips_provider_artifacts() -> None:
    visible_text, tool_calls = agent_service._parse_tool_calls(
        "根据知识库检索结果，我找到了相关信息。\n<minimax:tool_call>\n\n<minimax:tool_call>",
        rag_enabled=True,
    )

    assert tool_calls == []
    assert visible_text == "根据知识库检索结果，我找到了相关信息。"
