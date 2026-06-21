from __future__ import annotations

import json
import re
from typing import Any

from app.db.models import AgentSession
from app.schemas.agent import AgentSessionGoalDto, AgentSessionMemoryDto, AgentSessionTodoDto
from app.services.agent._constants import _timestamp_ms

MEMORY_TRIGGER_INITIAL_RUNS = 3
MEMORY_TRIGGER_INCREMENTAL_RUNS = 2
MEMORY_MAX_SUMMARY_CHARS = 800
MEMORY_MAX_LIST_ITEMS = 12
MEMORY_SUMMARY_STATUS_VALUES = {"idle", "pending", "processing", "ready", "failed"}
MEMORY_REDACTION_MARKER = "[REDACTED]"

_EMAIL_PATTERN = re.compile(r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?\d[\d -]{8,}\d)(?!\d)")
_API_KEY_PATTERN = re.compile(r"\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b", re.IGNORECASE)
_IDENTIFIER_PATTERN = re.compile(r"(?<!\d)\d{15,19}(?!\d)")
_SECRET_LINE_PATTERN = re.compile(
    r"(api[_ -]?key|token|secret|password|passwd|密码|口令|密钥)\s*[:：=]\s*[^\s,;]+",
    re.IGNORECASE,
)


def _redact_sensitive_text(value: str) -> str:
    redacted = _EMAIL_PATTERN.sub(MEMORY_REDACTION_MARKER, value)
    redacted = _PHONE_PATTERN.sub(MEMORY_REDACTION_MARKER, redacted)
    redacted = _API_KEY_PATTERN.sub(MEMORY_REDACTION_MARKER, redacted)
    redacted = _IDENTIFIER_PATTERN.sub(MEMORY_REDACTION_MARKER, redacted)
    redacted = _SECRET_LINE_PATTERN.sub(MEMORY_REDACTION_MARKER, redacted)
    return redacted.strip()


def _sanitize_memory_string(value: object, *, max_chars: int = 200) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = _redact_sensitive_text(value)
    if not normalized or MEMORY_REDACTION_MARKER in normalized:
        return None
    if len(normalized) > max_chars:
        normalized = normalized[: max_chars - 1].rstrip() + "…"
    return normalized


def _coerce_string_list(value: object, *, max_items: int = MEMORY_MAX_LIST_ITEMS) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        normalized = _sanitize_memory_string(item)
        if not normalized or normalized in items:
            continue
        items.append(normalized)
        if len(items) >= max_items:
            break
    return items


def _coerce_goal_list(value: object) -> list[AgentSessionGoalDto]:
    if not isinstance(value, list):
        return []
    goals: list[AgentSessionGoalDto] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = _sanitize_memory_string(item.get("title"))
        if not title:
            continue
        status = _sanitize_memory_string(item.get("status"), max_chars=40) or "active"
        goals.append(AgentSessionGoalDto(title=title, status=status))
        if len(goals) >= MEMORY_MAX_LIST_ITEMS:
            break
    return goals


def _coerce_todo_list(value: object) -> list[AgentSessionTodoDto]:
    if not isinstance(value, list):
        return []
    todos: list[AgentSessionTodoDto] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = _sanitize_memory_string(item.get("title"))
        if not title:
            continue
        status = _sanitize_memory_string(item.get("status"), max_chars=40) or "open"
        due_hint = _sanitize_memory_string(item.get("dueHint"), max_chars=80)
        source_run_id = item.get("sourceRunId")
        todos.append(
            AgentSessionTodoDto(
                title=title,
                status=status,
                dueHint=due_hint,
                sourceRunId=source_run_id if isinstance(source_run_id, str) and source_run_id.strip() else None,
            )
        )
        if len(todos) >= MEMORY_MAX_LIST_ITEMS:
            break
    return todos


def _build_memory_summary(summary: object) -> str:
    normalized = _sanitize_memory_string(summary, max_chars=MEMORY_MAX_SUMMARY_CHARS)
    return normalized or ""


def _extract_json_object(content: str) -> dict[str, Any]:
    stripped = content.strip()
    fenced_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", stripped, re.IGNORECASE)
    if fenced_match:
        stripped = fenced_match.group(1).strip()
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return {}
        try:
            parsed = json.loads(stripped[start : end + 1])
        except json.JSONDecodeError:
            return {}
    return parsed if isinstance(parsed, dict) else {}


def _normalize_memory_payload(payload: object) -> AgentSessionMemoryDto:
    if not isinstance(payload, dict):
        payload = {}
    status = payload.get("status")
    normalized_status = status if isinstance(status, str) and status in MEMORY_SUMMARY_STATUS_VALUES else "ready"
    return AgentSessionMemoryDto(
        summary=_build_memory_summary(payload.get("summary")),
        preferences=_coerce_string_list(payload.get("preferences")),
        facts=_coerce_string_list(payload.get("facts")),
        goals=_coerce_goal_list(payload.get("goals")),
        todos=_coerce_todo_list(payload.get("todos")),
        rules=_coerce_string_list(payload.get("rules")),
        status=normalized_status,
    )


def _parse_memory_model_output(content: str) -> AgentSessionMemoryDto:
    return _normalize_memory_payload(_extract_json_object(content))


def _to_agent_session_memory_dto(session: AgentSession) -> AgentSessionMemoryDto:
    status = session.memory_status if session.memory_status in MEMORY_SUMMARY_STATUS_VALUES else "idle"
    return AgentSessionMemoryDto(
        summary=_build_memory_summary(session.memory_summary),
        preferences=_coerce_string_list(session.memory_preferences_json),
        facts=_coerce_string_list(session.memory_facts_json),
        goals=_coerce_goal_list(session.memory_goals_json),
        todos=_coerce_todo_list(session.memory_todos_json),
        rules=_coerce_string_list(session.memory_rules_json),
        status=status,
        updatedAt=_timestamp_ms(session.memory_updated_at) if session.memory_updated_at else None,
        disabled=bool(session.memory_disabled),
        runCount=max(int(session.memory_run_count or 0), 0),
    )
