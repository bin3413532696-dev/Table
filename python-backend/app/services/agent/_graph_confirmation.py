from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx
from langgraph.graph import END, START, StateGraph
from sqlalchemy.ext.asyncio import AsyncSession
from typing_extensions import TypedDict

from app.db.models import AgentRun
from app.schemas.agent import AgentRunDetailDto, AgentRunToolExecutionDto

AgentEventEmitter = Callable[[dict[str, Any]], Awaitable[None]]
StreamCompletionFn = Callable[[Any, list[dict[str, str]]], Any]
ResolveRuntimeFn = Callable[[AsyncSession, str, str], Awaitable[Any]]
ExecutePendingConfirmationToolFn = Callable[
    [AsyncSession, str, AgentRunToolExecutionDto],
    Awaitable[AgentRunToolExecutionDto | None],
]
BuildContinuationProviderMessagesFn = Callable[
    [AgentRunDetailDto, AgentRunToolExecutionDto, AgentRunToolExecutionDto | None],
    list[dict[str, str]],
]
BuildConfirmedRunDetailFn = Callable[
    [AgentRun, AgentRunDetailDto, AgentRunToolExecutionDto, str, list[str], AgentRunToolExecutionDto | None],
    AgentRunDetailDto,
]
BuildFailedConfirmationRunDetailFn = Callable[
    [AgentRun, AgentRunDetailDto, AgentRunToolExecutionDto, str, list[str], str, AgentRunToolExecutionDto | None, bool],
    AgentRunDetailDto,
]


class AgentConfirmationGraphState(TypedDict):
    session: AsyncSession
    user_id: str
    run: AgentRun
    runtime: Any | None
    hooks: Any
    emit_event: AgentEventEmitter
    current_detail: AgentRunDetailDto
    pending_tool: AgentRunToolExecutionDto
    executed_tool: AgentRunToolExecutionDto | None
    provider_messages: list[dict[str, str]]
    assistant_text_chunks: list[str]
    assistant_text: str
    error_message: str | None
    raised_error_message: str | None
    include_llm_events: bool
    detail: AgentRunDetailDto | None


@dataclass(frozen=True)
class AgentConfirmationGraphDependencies:
    resolve_runtime: ResolveRuntimeFn
    stream_completion: StreamCompletionFn
    execute_pending_confirmation_tool: ExecutePendingConfirmationToolFn
    build_continuation_provider_messages: BuildContinuationProviderMessagesFn
    build_confirmed_run_detail: BuildConfirmedRunDetailFn
    build_failed_confirmation_run_detail: BuildFailedConfirmationRunDetailFn


def _route_after_confirmed_tool(state: AgentConfirmationGraphState) -> str:
    if state["detail"] is not None:
        return "end"
    return "continuation_llm"


def build_agent_confirmation_graph(
    deps: AgentConfirmationGraphDependencies,
):
    async def execute_confirmed_tool(state: AgentConfirmationGraphState) -> dict[str, Any]:
        session = state["session"]
        user_id = state["user_id"]
        run = state["run"]
        hooks = state["hooks"]
        pending_tool = state["pending_tool"]
        current_detail = state["current_detail"]

        await hooks.fire(
            "before_tool",
            run_id=str(run.id),
            session_id=str(run.session_id),
            user_id=user_id,
            tool_name=pending_tool.toolName,
            arguments=pending_tool.arguments,
            confirmation=True,
        )
        executed_tool = await deps.execute_pending_confirmation_tool(session, user_id, pending_tool)
        if executed_tool is not None:
            await hooks.fire(
                "after_tool",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                tool_name=executed_tool.toolName,
                status=executed_tool.status,
                result=executed_tool.result,
                error=executed_tool.errorMessage,
                confirmation=True,
            )

        if executed_tool is not None and executed_tool.status != "completed":
            error_message = executed_tool.errorMessage or "Confirmed tool execution failed."
            await hooks.fire(
                "on_run_error",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                stage="confirmation_tool",
                error=error_message,
            )
            detail = deps.build_failed_confirmation_run_detail(
                run,
                current_detail,
                pending_tool,
                "",
                [],
                error_message,
                executed_tool,
                False,
            )
            return {
                "executed_tool": executed_tool,
                "error_message": error_message,
                "detail": detail,
                "include_llm_events": False,
            }

        provider_messages = deps.build_continuation_provider_messages(current_detail, pending_tool, executed_tool)
        return {
            "executed_tool": executed_tool,
            "provider_messages": provider_messages,
        }

    async def continuation_llm(state: AgentConfirmationGraphState) -> dict[str, Any]:
        run = state["run"]
        hooks = state["hooks"]
        user_id = state["user_id"]
        emit_event = state["emit_event"]
        provider_messages = state["provider_messages"]
        assistant_text_chunks: list[str] = []
        runtime = state["runtime"] or await deps.resolve_runtime(state["session"], user_id, run.model)

        try:
            await hooks.fire(
                "before_llm",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                iteration=1,
                provider_messages=provider_messages,
                model=runtime.model,
                confirmation=True,
            )
            async for token in deps.stream_completion(runtime, provider_messages):
                assistant_text_chunks.append(token)
                await emit_event({"type": "token", "token": token})
            assistant_text = "".join(assistant_text_chunks)
            await hooks.fire(
                "after_llm",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                iteration=1,
                model=runtime.model,
                raw_text=assistant_text,
                confirmation=True,
            )
        except httpx.HTTPStatusError as exc:
            error_message = f"Agent provider request failed with HTTP {exc.response.status_code}."
            await hooks.fire(
                "on_run_error",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                stage="confirmation_llm",
                error=error_message,
            )
            detail = deps.build_failed_confirmation_run_detail(
                run,
                state["current_detail"],
                state["pending_tool"],
                "".join(assistant_text_chunks),
                assistant_text_chunks,
                error_message,
                state["executed_tool"],
                True,
            )
            return {
                "assistant_text_chunks": assistant_text_chunks,
                "assistant_text": "".join(assistant_text_chunks),
                "error_message": error_message,
                "raised_error_message": error_message,
                "detail": detail,
            }
        except Exception as exc:
            error_message = str(exc)
            await hooks.fire(
                "on_run_error",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                stage="confirmation_llm",
                error=error_message,
            )
            detail = deps.build_failed_confirmation_run_detail(
                run,
                state["current_detail"],
                state["pending_tool"],
                "".join(assistant_text_chunks),
                assistant_text_chunks,
                error_message,
                state["executed_tool"],
                True,
            )
            return {
                "assistant_text_chunks": assistant_text_chunks,
                "assistant_text": "".join(assistant_text_chunks),
                "error_message": error_message,
                "raised_error_message": error_message,
                "detail": detail,
            }

        detail = deps.build_confirmed_run_detail(
            run,
            state["current_detail"],
            state["pending_tool"],
            assistant_text,
            assistant_text_chunks,
            state["executed_tool"],
        )
        return {
            "runtime": runtime,
            "assistant_text_chunks": assistant_text_chunks,
            "assistant_text": assistant_text,
            "detail": detail,
        }

    workflow = StateGraph(AgentConfirmationGraphState)
    workflow.add_node("execute_confirmed_tool", execute_confirmed_tool)
    workflow.add_node("continuation_llm", continuation_llm)
    workflow.add_edge(START, "execute_confirmed_tool")
    workflow.add_conditional_edges(
        "execute_confirmed_tool",
        _route_after_confirmed_tool,
        {"continuation_llm": "continuation_llm", "end": END},
    )
    workflow.add_edge("continuation_llm", END)
    return workflow.compile()


async def run_agent_confirmation_graph(
    *,
    deps: AgentConfirmationGraphDependencies,
    session: AsyncSession,
    user_id: str,
    run: AgentRun,
    hooks: Any,
    current_detail: AgentRunDetailDto,
    pending_tool: AgentRunToolExecutionDto,
    emit_event: AgentEventEmitter,
) -> AgentConfirmationGraphState:
    graph = build_agent_confirmation_graph(deps)
    initial_state: AgentConfirmationGraphState = {
        "session": session,
        "user_id": user_id,
        "run": run,
        "runtime": None,
        "hooks": hooks,
        "emit_event": emit_event,
        "current_detail": current_detail,
        "pending_tool": pending_tool,
        "executed_tool": None,
        "provider_messages": [],
        "assistant_text_chunks": [],
        "assistant_text": "",
        "error_message": None,
        "raised_error_message": None,
        "include_llm_events": True,
        "detail": None,
    }
    return await graph.ainvoke(initial_state)
