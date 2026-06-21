from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx
from langgraph.graph import END, START, StateGraph
from sqlalchemy.ext.asyncio import AsyncSession
from typing_extensions import TypedDict

from app.db.models import AgentRun
from app.schemas.agent import AgentRunMessageDto, AgentRunToolExecutionDto, TimelineEvent
from app.services.agent._constants import MAX_AGENT_ITERATIONS, AgentToolCall, _iso_timestamp, _now, _timestamp_ms
from app.services.agent._tools import _append_assistant_message, _append_tool_message, _build_tool_result_prompt

AgentEventEmitter = Callable[[dict[str, Any]], Awaitable[None]]
StreamCompletionFn = Callable[[Any, list[dict[str, str]]], Any]
ExecuteToolCallFn = Callable[[AsyncSession, str, AgentToolCall], Awaitable[AgentRunToolExecutionDto]]
ParseToolCallsFn = Callable[[str], tuple[str, list[AgentToolCall]]]
ToolRequiresConfirmationFn = Callable[[str], bool]
BuildPendingToolCallFn = Callable[[AgentToolCall, int], AgentRunToolExecutionDto]


class AgentExecutionGraphState(TypedDict):
    session: AsyncSession
    user_id: str
    run: AgentRun
    runtime: Any
    hooks: Any
    emit_event: AgentEventEmitter
    run_messages: list[AgentRunMessageDto]
    provider_messages: list[dict[str, str]]
    executed_tool_calls: list[AgentRunToolExecutionDto]
    pending_tool_calls: list[AgentRunToolExecutionDto]
    assistant_text_chunks: list[str]
    timeline: list[TimelineEvent]
    final_text: str
    status: str
    error_message: str | None
    iteration_count: int
    raised_error_message: str | None
    parsed_tool_calls: list[AgentToolCall]


@dataclass(frozen=True)
class AgentExecutionGraphDependencies:
    stream_completion: StreamCompletionFn
    execute_tool_call: ExecuteToolCallFn
    parse_tool_calls: ParseToolCallsFn
    tool_requires_confirmation: ToolRequiresConfirmationFn
    build_pending_tool_call: BuildPendingToolCallFn


def _route_after_llm(state: AgentExecutionGraphState) -> str:
    if state["parsed_tool_calls"]:
        return "execute_tools"
    if state["status"] in {"failed", "completed", "waiting_confirmation"}:
        return "end"
    return "end"


def _route_after_tools(state: AgentExecutionGraphState) -> str:
    if state["status"] in {"failed", "waiting_confirmation"}:
        return "end"
    if state["iteration_count"] >= MAX_AGENT_ITERATIONS:
        return "iteration_limit"
    return "llm_round"


def build_agent_execution_graph(
    deps: AgentExecutionGraphDependencies,
):
    async def llm_round(state: AgentExecutionGraphState) -> dict[str, Any]:
        user_id = state["user_id"]
        run = state["run"]
        runtime = state["runtime"]
        hooks = state["hooks"]
        emit_event = state["emit_event"]
        provider_messages = state["provider_messages"]
        run_messages = state["run_messages"]
        assistant_text_chunks = state["assistant_text_chunks"]
        timeline = state["timeline"]

        llm_started_at = _iso_timestamp()
        round_tokens: list[str] = []
        next_status = "running"
        error_message = state["error_message"]
        raised_error_message = state["raised_error_message"]
        pending_tool_calls: list[AgentRunToolExecutionDto] = []
        parsed_tool_calls: list[AgentToolCall] = []
        final_text = state["final_text"]
        iteration_count = state["iteration_count"]

        try:
            await hooks.fire(
                "before_llm",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                iteration=iteration_count + 1,
                provider_messages=provider_messages,
                model=runtime.model,
            )
            async for token in deps.stream_completion(runtime, provider_messages):
                round_tokens.append(token)
                await emit_event({"type": "token", "token": token})
            await hooks.fire(
                "after_llm",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                iteration=iteration_count + 1,
                model=runtime.model,
                raw_text="".join(round_tokens),
            )
        except httpx.HTTPStatusError as exc:
            partial_text = "".join(round_tokens)
            if partial_text:
                assistant_created_at = _timestamp_ms(_now())
                run_messages = _append_assistant_message(run_messages, partial_text, created_at=assistant_created_at)
                assistant_text_chunks.append(partial_text)
                final_text = partial_text
            timeline.extend(
                [
                    TimelineEvent(type="llm_start", timestamp=llm_started_at, data={"model": run.model}),
                    TimelineEvent(
                        type="interrupted",
                        timestamp=_iso_timestamp(),
                        data={"reason": "provider_http_error", "statusCode": exc.response.status_code},
                    ),
                ]
            )
            next_status = "failed"
            error_message = f"Agent provider request failed with HTTP {exc.response.status_code}."
            raised_error_message = error_message
            await hooks.fire(
                "on_run_error",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                stage="llm",
                error=error_message,
            )
            return {
                "run_messages": run_messages,
                "assistant_text_chunks": assistant_text_chunks,
                "timeline": timeline,
                "final_text": final_text,
                "status": next_status,
                "error_message": error_message,
                "raised_error_message": raised_error_message,
                "pending_tool_calls": pending_tool_calls,
                "parsed_tool_calls": parsed_tool_calls,
            }
        except Exception as exc:
            partial_text = "".join(round_tokens)
            if partial_text:
                assistant_created_at = _timestamp_ms(_now())
                run_messages = _append_assistant_message(run_messages, partial_text, created_at=assistant_created_at)
                assistant_text_chunks.append(partial_text)
                final_text = partial_text
            timeline.extend(
                [
                    TimelineEvent(type="llm_start", timestamp=llm_started_at, data={"model": run.model}),
                    TimelineEvent(type="interrupted", timestamp=_iso_timestamp(), data={"reason": "provider_error"}),
                ]
            )
            next_status = "failed"
            error_message = str(exc)
            raised_error_message = error_message
            await hooks.fire(
                "on_run_error",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                stage="llm",
                error=error_message,
            )
            return {
                "run_messages": run_messages,
                "assistant_text_chunks": assistant_text_chunks,
                "timeline": timeline,
                "final_text": final_text,
                "status": next_status,
                "error_message": error_message,
                "raised_error_message": raised_error_message,
                "pending_tool_calls": pending_tool_calls,
                "parsed_tool_calls": parsed_tool_calls,
            }

        assistant_raw_text = "".join(round_tokens)
        parsed_text, parsed_tool_calls = deps.parse_tool_calls(assistant_raw_text)
        assistant_visible_text = parsed_text if parsed_text or not parsed_tool_calls else ""
        assistant_created_at = _timestamp_ms(_now())
        run_messages = _append_assistant_message(run_messages, assistant_visible_text, created_at=assistant_created_at)
        provider_messages.append({"role": "assistant", "content": assistant_visible_text})
        assistant_text_chunks.append(assistant_visible_text or assistant_raw_text)
        final_text = assistant_visible_text
        iteration_count += 1
        timeline.extend(
            [
                TimelineEvent(type="llm_start", timestamp=llm_started_at, data={"model": run.model}),
                TimelineEvent(
                    type="llm_end",
                    timestamp=_iso_timestamp(),
                    data={"model": run.model, "hasToolCalls": bool(parsed_tool_calls)},
                ),
            ]
        )

        if not parsed_tool_calls:
            next_status = "completed"
            parsed_tool_calls = []
        else:
            confirmation_calls = [
                tool_call for tool_call in parsed_tool_calls if deps.tool_requires_confirmation(tool_call.name)
            ]
            if confirmation_calls:
                pending_tool_calls = [
                    deps.build_pending_tool_call(tool_call, assistant_created_at) for tool_call in confirmation_calls
                ]
                parsed_tool_calls = [
                    tool_call for tool_call in parsed_tool_calls if not deps.tool_requires_confirmation(tool_call.name)
                ]
                next_status = "waiting_confirmation"

        return {
            "run_messages": run_messages,
            "provider_messages": provider_messages,
            "assistant_text_chunks": assistant_text_chunks,
            "timeline": timeline,
            "final_text": final_text,
            "iteration_count": iteration_count,
            "status": next_status,
            "pending_tool_calls": pending_tool_calls,
            "parsed_tool_calls": parsed_tool_calls,
            "error_message": error_message,
            "raised_error_message": raised_error_message,
        }

    async def execute_tools(state: AgentExecutionGraphState) -> dict[str, Any]:
        session = state["session"]
        user_id = state["user_id"]
        run = state["run"]
        hooks = state["hooks"]
        parsed_tool_calls = state["parsed_tool_calls"]
        run_messages = state["run_messages"]
        provider_messages = state["provider_messages"]
        executed_tool_calls = state["executed_tool_calls"]
        timeline = state["timeline"]
        error_message = state["error_message"]
        next_status = state["status"]

        round_executed_tools: list[AgentRunToolExecutionDto] = []
        for tool_call in parsed_tool_calls:
            tool_started_at = _iso_timestamp()
            await hooks.fire(
                "before_tool",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                tool_name=tool_call.name,
                arguments=tool_call.arguments,
            )
            executed_tool = await deps.execute_tool_call(session, user_id, tool_call)
            round_executed_tools.append(executed_tool)
            executed_tool_calls.append(executed_tool)
            run_messages = _append_tool_message(
                run_messages,
                executed_tool,
                created_at=executed_tool.createdAt or _timestamp_ms(_now()),
            )
            timeline.extend(
                [
                    TimelineEvent(
                        type="tool_start",
                        timestamp=tool_started_at,
                        data={"toolName": executed_tool.toolName, "arguments": executed_tool.arguments},
                    ),
                    TimelineEvent(
                        type="tool_end",
                        timestamp=_iso_timestamp(),
                        data={"toolName": executed_tool.toolName, "success": executed_tool.status == "completed"},
                    ),
                ]
            )
            await hooks.fire(
                "after_tool",
                run_id=str(run.id),
                session_id=str(run.session_id),
                user_id=user_id,
                tool_name=executed_tool.toolName,
                status=executed_tool.status,
                result=executed_tool.result,
                error=executed_tool.errorMessage,
            )
            if executed_tool.status != "completed" and error_message is None:
                next_status = "failed"
                error_message = executed_tool.errorMessage or f"Tool execution failed: {executed_tool.toolName}"
                await hooks.fire(
                    "on_run_error",
                    run_id=str(run.id),
                    session_id=str(run.session_id),
                    user_id=user_id,
                    stage="tool",
                    error=error_message,
                )

        if next_status != "failed":
            provider_messages.append({"role": "user", "content": _build_tool_result_prompt(round_executed_tools)})

        return {
            "run_messages": run_messages,
            "provider_messages": provider_messages,
            "executed_tool_calls": executed_tool_calls,
            "timeline": timeline,
            "status": next_status,
            "error_message": error_message,
            "parsed_tool_calls": [],
        }

    async def mark_iteration_limit(state: AgentExecutionGraphState) -> dict[str, Any]:
        run = state["run"]
        hooks = state["hooks"]
        user_id = state["user_id"]
        timeline = state["timeline"]
        error_message = "Agent iteration limit reached."
        timeline.append(
            TimelineEvent(
                type="interrupted",
                timestamp=_iso_timestamp(),
                data={"reason": "iteration_limit"},
            )
        )
        await hooks.fire(
            "on_run_error",
            run_id=str(run.id),
            session_id=str(run.session_id),
            user_id=user_id,
            stage="iteration_limit",
            error=error_message,
        )
        return {
            "timeline": timeline,
            "status": "failed",
            "error_message": error_message,
        }

    workflow = StateGraph(AgentExecutionGraphState)
    workflow.add_node("llm_round", llm_round)
    workflow.add_node("execute_tools", execute_tools)
    workflow.add_node("iteration_limit", mark_iteration_limit)
    workflow.add_edge(START, "llm_round")
    workflow.add_conditional_edges("llm_round", _route_after_llm, {"execute_tools": "execute_tools", "end": END})
    workflow.add_conditional_edges(
        "execute_tools",
        _route_after_tools,
        {"llm_round": "llm_round", "iteration_limit": "iteration_limit", "end": END},
    )
    workflow.add_edge("iteration_limit", END)
    return workflow.compile()


async def run_agent_execution_graph(
    *,
    deps: AgentExecutionGraphDependencies,
    session: AsyncSession,
    user_id: str,
    run: AgentRun,
    runtime: Any,
    hooks: Any,
    run_messages: list[AgentRunMessageDto],
    provider_messages: list[dict[str, str]],
    emit_event: AgentEventEmitter,
) -> AgentExecutionGraphState:
    graph = build_agent_execution_graph(deps)
    initial_state: AgentExecutionGraphState = {
        "session": session,
        "user_id": user_id,
        "run": run,
        "runtime": runtime,
        "hooks": hooks,
        "emit_event": emit_event,
        "run_messages": run_messages,
        "provider_messages": provider_messages,
        "executed_tool_calls": [],
        "pending_tool_calls": [],
        "assistant_text_chunks": [],
        "timeline": [],
        "final_text": "",
        "status": "running",
        "error_message": None,
        "iteration_count": 0,
        "raised_error_message": None,
        "parsed_tool_calls": [],
    }
    return await graph.ainvoke(initial_state)
