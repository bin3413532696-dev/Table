from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Any

from fastapi import HTTPException


def http_not_found(message: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": message})


def http_conflict(message: str) -> HTTPException:
    return HTTPException(status_code=409, detail={"error": "CONFLICT", "message": message})


def http_bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail={"error": "BAD_REQUEST", "message": message})


def sse_error_payload(code: str, message: str) -> dict[str, str]:
    return {"error": code, "message": message}


def encode_sse_event(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def normalize_http_exception_detail(exc: HTTPException) -> dict[str, str]:
    if isinstance(exc.detail, dict):
        return {
            "error": str(exc.detail.get("error") or "HTTP_ERROR"),
            "message": str(exc.detail.get("message") or exc.detail.get("error") or "Unexpected server error"),
        }
    return sse_error_payload("HTTP_ERROR", str(exc.detail))


async def stream_with_standard_errors(
    stream_factory: Callable[[], AsyncIterator[dict[str, Any]]],
    *,
    lookup_errors: tuple[type[BaseException], ...] = (),
    conflict_errors: tuple[type[BaseException], ...] = (),
) -> AsyncIterator[str]:
    try:
        async for event in stream_factory():
            event_name = str(event.get("type") or "message")
            yield encode_sse_event(event_name, event)
        yield encode_sse_event("done", {"ok": True})
    except HTTPException as exc:
        yield encode_sse_event("error", normalize_http_exception_detail(exc))
    except lookup_errors as exc:
        yield encode_sse_event("error", sse_error_payload("NOT_FOUND", str(exc)))
    except conflict_errors as exc:
        yield encode_sse_event("error", sse_error_payload("CONFLICT", str(exc)))
    except Exception as exc:
        yield encode_sse_event(
            "error",
            sse_error_payload("INFRASTRUCTURE_ERROR", str(exc) or "Unexpected server error"),
        )
