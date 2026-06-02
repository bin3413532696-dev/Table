from __future__ import annotations

from app.repositories.knowledge import normalize_tags as normalize_note_tags
from app.repositories.knowledge import search_notes as search_notes_repo
from app.services.agent.registry import AgentToolDefinition, AgentToolExecutionContext, register_tool_definition
from app.services.agent.tools.common import int_arg, string_arg


async def _search_knowledge(context: AgentToolExecutionContext, arguments: dict[str, object]) -> object:
    tags_arg = arguments.get("tags")
    tags = normalize_note_tags([tags_arg] if isinstance(tags_arg, str) else tags_arg)
    return await search_notes_repo(
        context.session,
        context.user_id,
        query=string_arg(arguments, "query") or "",
        tags=tags,
        limit=int_arg(arguments, "limit", 8),
        offset=0,
    )


def register_knowledge_tools() -> None:
    register_tool_definition(
        AgentToolDefinition(
            name="search_knowledge",
            description="按关键词和标签搜索知识笔记。",
            prompt_signature="search_knowledge(query?, tags?, limit?)",
            category="query",
            module="knowledge",
            execute=_search_knowledge,
        )
    )
