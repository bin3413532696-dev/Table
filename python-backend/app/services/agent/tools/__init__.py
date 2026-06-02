from __future__ import annotations

from app.services.agent.tools.finance import register_finance_tools
from app.services.agent.tools.knowledge import register_knowledge_tools
from app.services.agent.tools.rag import register_rag_tools
from app.services.agent.tools.tasks import register_task_tools

_REGISTERED = False


def ensure_builtin_tool_definitions_registered() -> None:
    global _REGISTERED
    if _REGISTERED:
        return
    register_task_tools()
    register_finance_tools()
    register_knowledge_tools()
    register_rag_tools()
    _REGISTERED = True
