from __future__ import annotations

from app.repositories.knowledge_rag import get_chunk_by_id as get_rag_chunk_by_id
from app.schemas.knowledge_rag import HybridSearchRequest
from app.services.agent.registry import (
    AgentToolAvailabilityContext,
    AgentToolDefinition,
    AgentToolExecutionContext,
    register_tool_definition,
)
from app.services.agent.tools.common import int_arg, string_arg
from app.services.knowledge_rag import build_search_context, search_service, search_with_context_service


def _rag_enabled(context: AgentToolAvailabilityContext) -> bool:
    return context.rag_enabled


def _build_chunk_read_result(chunk: dict[str, object] | None, *, error_message: str | None = None) -> str:
    if error_message:
        return f"<chunk_read_result><error>{error_message}</error></chunk_read_result>"
    if not chunk:
        return "<chunk_read_result><error>未找到 chunk</error></chunk_read_result>"

    document_title = str(chunk.get("document_title") or "")
    heading_chain = chunk.get("heading_chain")
    source = f"{document_title} > {heading_chain}" if isinstance(heading_chain, str) and heading_chain else document_title
    content = str(chunk.get("parent_content") or chunk.get("content") or "")
    return (
        "<chunk_read_result>\n"
        f"<chunk_id>{chunk.get('id')}</chunk_id>\n"
        f"<parent_chunk_id>{chunk.get('parent_id') or ''}</parent_chunk_id>\n"
        f"<document_title>{document_title}</document_title>\n"
        f"<source>{source}</source>\n"
        f"<content>{content}</content>\n"
        "</chunk_read_result>"
    )


async def _search_knowledge_rag(context: AgentToolExecutionContext, arguments: dict[str, object]) -> object:
    query = string_arg(arguments, "query")
    if not query:
        return {"context": "", "results": [], "message": "请提供查询内容。"}
    payload = HybridSearchRequest(
        query=query,
        limit=int_arg(arguments, "limit", 10),
        mode="semantic",
        enableQueryPreprocess=True,
        enableRewrite=True,
        enableRerank=context.settings.reranker_enabled,
        enableMmr=context.settings.mmr_enabled,
    )
    return await search_with_context_service(context.session, context.user_id, payload, settings=context.settings)


async def _semantic_search(context: AgentToolExecutionContext, arguments: dict[str, object]) -> object:
    payload = HybridSearchRequest(
        query=string_arg(arguments, "query") or "",
        tags=arguments.get("tags") if isinstance(arguments.get("tags"), list) else None,
        documentIds=arguments.get("documentIds") if isinstance(arguments.get("documentIds"), list) else None,
        limit=int_arg(arguments, "limit", 10),
        mode="semantic",
        enableQueryPreprocess=context.settings.query_preprocessor_enabled,
        enableRewrite=True,
        enableRerank=context.settings.reranker_enabled,
        enableMmr=context.settings.mmr_enabled,
    )
    return (await search_service(context.session, context.user_id, payload, settings=context.settings)).model_dump()


async def _keyword_search(context: AgentToolExecutionContext, arguments: dict[str, object]) -> object:
    payload = HybridSearchRequest(
        query=string_arg(arguments, "query") or "",
        limit=int_arg(arguments, "limit", 10),
        mode="keyword",
    )
    return (await search_service(context.session, context.user_id, payload, settings=context.settings)).model_dump()


async def _chunk_read(context: AgentToolExecutionContext, arguments: dict[str, object]) -> object:
    chunk_id = string_arg(arguments, "chunkId")
    if not chunk_id:
        raise ValueError("chunk_read requires chunkId.")
    chunk = await get_rag_chunk_by_id(context.session, context.user_id, chunk_id)
    return _build_chunk_read_result(chunk, error_message=None if chunk else f"未找到 chunk: {chunk_id}")


async def _cite_sources(_context: AgentToolExecutionContext, arguments: dict[str, object]) -> object:
    chunk_ids = arguments.get("chunkIds")
    if not isinstance(chunk_ids, list) or not all(isinstance(item, str) for item in chunk_ids):
        raise ValueError("cite_sources requires chunkIds.")
    return {
        "cited": chunk_ids,
        "count": len(chunk_ids),
        "message": f"已标注 {len(chunk_ids)} 个来源引用。",
    }


async def _rag_answer(context: AgentToolExecutionContext, arguments: dict[str, object]) -> object:
    question = string_arg(arguments, "question")
    if not question:
        return {
            "context": "",
            "sources": [],
            "confidence": 0,
            "message": "请提供查询内容。",
        }

    payload = HybridSearchRequest(
        query=question,
        tags=arguments.get("tags") if isinstance(arguments.get("tags"), list) else None,
        limit=int_arg(arguments, "limit", 10),
        mode="semantic",
        enableQueryPreprocess=context.settings.query_preprocessor_enabled,
        enableRewrite=True,
        enableRerank=context.settings.reranker_enabled,
        enableMmr=context.settings.mmr_enabled,
    )
    response = await search_service(context.session, context.user_id, payload, settings=context.settings)
    if not response.results:
        return {
            "context": "知识库未找到相关内容",
            "sources": [],
            "confidence": 0,
            "message": "未找到相关结果，请尝试其他查询方式。",
            "searched": True,
        }

    max_score = max(result_item.score for result_item in response.results)
    confidence = min(max_score * 0.7 + min(len(response.results) / 10, 0.3), 1.0)
    return {
        "context": build_search_context(response.results, max_chars=3000),
        "sources": [
            {
                "chunkId": result_item.id,
                "documentTitle": result_item.documentTitle,
                "score": result_item.score,
            }
            for result_item in response.results
        ],
        "confidence": round(confidence, 2),
        "message": f"找到 {len(response.results)} 条相关内容，置信度 {(confidence * 100):.0f}%",
        "searched": True,
        "maxScore": max_score,
    }


def register_rag_tools() -> None:
    definitions = [
        AgentToolDefinition(
            name="search_knowledge_rag",
            description="执行知识库 RAG 查询并返回上下文结果。",
            prompt_signature="search_knowledge_rag(query!, limit?)",
            category="query",
            module="knowledge-rag",
            execute=_search_knowledge_rag,
            enabled_when=_rag_enabled,
        ),
        AgentToolDefinition(
            name="semantic_search",
            description="对知识库执行语义搜索。",
            prompt_signature="semantic_search(query!, tags?, documentIds?, limit?)",
            category="query",
            module="knowledge-rag",
            execute=_semantic_search,
            enabled_when=_rag_enabled,
        ),
        AgentToolDefinition(
            name="keyword_search",
            description="对知识库执行关键词搜索。",
            prompt_signature="keyword_search(query!, limit?)",
            category="query",
            module="knowledge-rag",
            execute=_keyword_search,
            enabled_when=_rag_enabled,
        ),
        AgentToolDefinition(
            name="chunk_read",
            description="读取单个知识库 chunk 的完整内容。",
            prompt_signature="chunk_read(chunkId!)",
            category="query",
            module="knowledge-rag",
            execute=_chunk_read,
            enabled_when=_rag_enabled,
        ),
        AgentToolDefinition(
            name="cite_sources",
            description="标注最终回答引用的 chunk 来源。",
            prompt_signature="cite_sources(chunkIds!)",
            category="query",
            module="knowledge-rag",
            execute=_cite_sources,
            enabled_when=_rag_enabled,
        ),
        AgentToolDefinition(
            name="rag_answer",
            description="优先返回适合问答的知识库检索结果与上下文。",
            prompt_signature="rag_answer(question!, tags?, limit?)",
            category="query",
            module="knowledge-rag",
            execute=_rag_answer,
            enabled_when=_rag_enabled,
        ),
    ]
    for definition in definitions:
        register_tool_definition(definition)
