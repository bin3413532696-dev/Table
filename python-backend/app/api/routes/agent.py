import json
from typing import Annotated
from uuid import UUID

from app.dependencies import AuthenticatedUser, DbSession
from app.schemas.agent import (
    AgentDeleteResponse,
    AgentPersonaDto,
    AgentRunDetailDto,
    AgentRunDto,
    AgentRunListResponse,
    AgentRuntimeStatusDto,
    AgentSessionDetailDto,
    AgentSessionDto,
    AgentSessionListResponse,
    CreateAgentRunRequest,
    CreateAgentSessionRequest,
    ListAgentRunsQuery,
    ListAgentSessionsQuery,
    UpdateAgentRunRequest,
    UpdateAgentSessionRequest,
)
from app.services.agent import (
    confirm_agent_tool_record,
    create_agent_run_record,
    create_agent_session_record,
    delete_agent_run_record,
    delete_agent_session_record,
    get_agent_persona,
    get_agent_run_detail,
    get_agent_run_list,
    get_agent_runtime_status,
    get_agent_session_detail,
    get_agent_session_list,
    reject_agent_tool_record,
    stream_agent_run_record,
    stream_confirm_agent_tool_record,
    stream_reject_agent_tool_record,
    update_agent_persona_record,
    update_agent_run_record,
    update_agent_session_record,
)
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/agent")


def _encode_sse_event(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _tool_not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"error": "NOT_FOUND", "message": "Agent run or tool execution not found"},
    )


@router.get("/health", response_model=AgentRuntimeStatusDto)
async def agent_health(session: DbSession, user: AuthenticatedUser) -> AgentRuntimeStatusDto:
    return await get_agent_runtime_status(session, user.user_id)


@router.get("/persona", response_model=AgentPersonaDto)
async def fetch_agent_persona(session: DbSession, user: AuthenticatedUser) -> AgentPersonaDto:
    return await get_agent_persona(session, user.user_id)


@router.put("/persona", response_model=AgentPersonaDto)
async def save_agent_persona(
    payload: AgentPersonaDto,
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentPersonaDto:
    return await update_agent_persona_record(session, user.user_id, payload)


@router.get("/sessions", response_model=AgentSessionListResponse)
async def list_agent_sessions_route(
    query: Annotated[ListAgentSessionsQuery, Depends()],
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentSessionListResponse:
    items, total = await get_agent_session_list(session, user.user_id, query)
    return AgentSessionListResponse(items=items, total=total)


@router.get("/sessions/{session_id}", response_model=AgentSessionDetailDto)
async def get_agent_session_route(
    session_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentSessionDetailDto:
    item = await get_agent_session_detail(session, user.user_id, str(session_id))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Session not found"})
    return item


@router.post("/sessions", response_model=AgentSessionDto, status_code=status.HTTP_201_CREATED)
async def create_agent_session_route(
    payload: CreateAgentSessionRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentSessionDto:
    return await create_agent_session_record(session, user.user_id, payload)


@router.patch("/sessions/{session_id}", response_model=AgentSessionDto)
async def patch_agent_session(
    session_id: UUID,
    payload: UpdateAgentSessionRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentSessionDto:
    item = await update_agent_session_record(session, user.user_id, str(session_id), payload)
    if not item:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Session not found"})
    return item


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_agent_session(
    session_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> Response:
    item = await delete_agent_session_record(session, user.user_id, str(session_id))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Session not found"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/runs", response_model=AgentRunListResponse)
async def list_agent_runs_route(
    query: Annotated[ListAgentRunsQuery, Depends()],
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentRunListResponse:
    return await get_agent_run_list(session, user.user_id, query)


@router.post("/runs", response_model=AgentRunDetailDto, status_code=status.HTTP_201_CREATED)
async def create_agent_run_route(
    payload: CreateAgentRunRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentRunDetailDto:
    return await create_agent_run_record(session, user.user_id, payload)


@router.post("/runs/stream")
async def stream_agent_run_route(
    payload: CreateAgentRunRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> StreamingResponse:
    async def event_stream():
        try:
            async for event in stream_agent_run_record(session, user.user_id, payload):
                event_name = str(event.get("type") or "message")
                yield _encode_sse_event(event_name, event)
            yield _encode_sse_event("done", {"ok": True})
        except HTTPException as exc:
            if isinstance(exc.detail, dict):
                detail = exc.detail
            else:
                detail = {"message": str(exc.detail)}
            yield _encode_sse_event("error", detail)
        except Exception as exc:
            yield _encode_sse_event("error", {"message": str(exc) or "Unexpected server error"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/runs/{run_id}", response_model=AgentRunDetailDto)
async def get_agent_run_route(
    run_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentRunDetailDto:
    item = await get_agent_run_detail(session, user.user_id, str(run_id))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Agent run not found"})
    return item


@router.patch("/runs/{run_id}", response_model=AgentRunDto)
async def patch_agent_run(
    run_id: UUID,
    payload: UpdateAgentRunRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentRunDto:
    item = await update_agent_run_record(session, user.user_id, str(run_id), payload)
    if not item:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Agent run not found"})
    return item


@router.delete("/runs/{run_id}", response_model=AgentDeleteResponse)
async def remove_agent_run(
    run_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentDeleteResponse:
    try:
        item = await delete_agent_run_record(session, user.user_id, str(run_id))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail={"error": "CONFLICT", "message": str(exc)}) from exc

    if not item:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": "Agent run not found"})
    return item


@router.post("/runs/{run_id}/tools/{tool_execution_id}/confirm", response_model=AgentRunDetailDto)
async def confirm_agent_tool_route(
    run_id: UUID,
    tool_execution_id: str,
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentRunDetailDto:
    try:
        item = await confirm_agent_tool_record(session, user.user_id, str(run_id), tool_execution_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail={"error": "CONFLICT", "message": str(exc)}) from exc

    if not item:
        raise _tool_not_found()
    return item


@router.post("/runs/{run_id}/tools/{tool_execution_id}/confirm/stream")
async def confirm_agent_tool_stream_route(
    run_id: UUID,
    tool_execution_id: str,
    session: DbSession,
    user: AuthenticatedUser,
) -> StreamingResponse:
    async def event_stream():
        try:
            async for event in stream_confirm_agent_tool_record(session, user.user_id, str(run_id), tool_execution_id):
                event_name = str(event.get("type") or "message")
                yield _encode_sse_event(event_name, event)
            yield _encode_sse_event("done", {"ok": True})
        except LookupError as exc:
            yield _encode_sse_event("error", {"message": str(exc)})
        except ValueError as exc:
            yield _encode_sse_event("error", {"message": str(exc)})
        except Exception as exc:
            yield _encode_sse_event("error", {"message": str(exc) or "Unexpected server error"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/runs/{run_id}/tools/{tool_execution_id}/reject", response_model=AgentRunDetailDto)
async def reject_agent_tool_route(
    run_id: UUID,
    tool_execution_id: str,
    session: DbSession,
    user: AuthenticatedUser,
) -> AgentRunDetailDto:
    try:
        item = await reject_agent_tool_record(session, user.user_id, str(run_id), tool_execution_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail={"error": "CONFLICT", "message": str(exc)}) from exc

    if not item:
        raise _tool_not_found()
    return item


@router.post("/runs/{run_id}/tools/{tool_execution_id}/reject/stream")
async def reject_agent_tool_stream_route(
    run_id: UUID,
    tool_execution_id: str,
    session: DbSession,
    user: AuthenticatedUser,
) -> StreamingResponse:
    async def event_stream():
        try:
            async for event in stream_reject_agent_tool_record(session, user.user_id, str(run_id), tool_execution_id):
                event_name = str(event.get("type") or "message")
                yield _encode_sse_event(event_name, event)
            yield _encode_sse_event("done", {"ok": True})
        except LookupError as exc:
            yield _encode_sse_event("error", {"message": str(exc)})
        except ValueError as exc:
            yield _encode_sse_event("error", {"message": str(exc)})
        except Exception as exc:
            yield _encode_sse_event("error", {"message": str(exc) or "Unexpected server error"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
