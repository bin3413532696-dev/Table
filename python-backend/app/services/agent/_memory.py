from __future__ import annotations

import json
import re
from typing import Any

from app.db.models import AgentRun, AgentSession
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


def _has_session_memory(session: AgentSession) -> bool:
    memory = _to_agent_session_memory_dto(session)
    return bool(
        memory.summary
        or memory.preferences
        or memory.facts
        or memory.goals
        or memory.todos
        or memory.rules
    )


def _build_session_memory_block(session: AgentSession) -> str:
    memory = _to_agent_session_memory_dto(session)
    if memory.disabled or memory.status != "ready" or not _has_session_memory(session):
        return ""

    lines = ["【会话记忆】"]
    if memory.summary:
        lines.append(f"摘要：{memory.summary}")
    if memory.preferences:
        lines.append("用户偏好：" + "；".join(memory.preferences))
    if memory.facts:
        lines.append("已确认事实：" + "；".join(memory.facts))
    if memory.goals:
        lines.append(
            "当前目标："
            + "；".join(f"{goal.title}（{goal.status}）" for goal in memory.goals)
        )
    if memory.todos:
        lines.append(
            "待办事项："
            + "；".join(
                f"{todo.title}（{todo.status}{f'，{todo.dueHint}' if todo.dueHint else ''}）"
                for todo in memory.todos
            )
        )
    if memory.rules:
        lines.append("执行规则：" + "；".join(memory.rules))
    lines.append("以上记忆仅供参考，若与用户当前明确指令冲突，以当前指令为准。")
    return "\n".join(lines)


def _eligible_memory_runs(runs: list[AgentRun]) -> list[AgentRun]:
    return [run for run in runs if run.status in {"completed", "waiting_confirmation"}]


def _should_refresh_session_memory(session: AgentSession, runs: list[AgentRun]) -> bool:
    if session.memory_disabled:
        return False
    eligible_runs = _eligible_memory_runs(runs)
    eligible_count = len(eligible_runs)
    if eligible_count < MEMORY_TRIGGER_INITIAL_RUNS:
        return False

    recorded_count = max(int(session.memory_run_count or 0), 0)
    if recorded_count <= 0:
        return True

    if recorded_count > eligible_count:
        return True

    delta_count = eligible_count - recorded_count
    if session.memory_status == "failed":
        return delta_count >= 1
    return delta_count >= MEMORY_TRIGGER_INCREMENTAL_RUNS


def _select_runs_for_memory_refresh(session: AgentSession, runs: list[AgentRun]) -> tuple[list[AgentRun], int]:
    eligible_runs = _eligible_memory_runs(runs)
    eligible_count = len(eligible_runs)
    recorded_count = max(int(session.memory_run_count or 0), 0)

    if recorded_count <= 0 or recorded_count > eligible_count:
        return eligible_runs, eligible_count
    return eligible_runs[recorded_count:], eligible_count


def _format_runs_for_memory_prompt(runs: list[AgentRun]) -> str:
    entries: list[str] = []
    for run in runs:
        messages = run.messages_json if isinstance(run.messages_json, list) else []
        visible_messages: list[str] = []
        for message in messages:
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            content = message.get("content")
            if role not in {"user", "assistant"} or not isinstance(content, str):
                continue
            redacted = _redact_sensitive_text(content)
            if not redacted:
                continue
            visible_messages.append(f"{role}: {redacted}")
        if not visible_messages:
            visible_messages.append(f"user: {_redact_sensitive_text(run.input_text)}")
            if run.final_text:
                visible_messages.append(f"assistant: {_redact_sensitive_text(run.final_text)}")
        entries.append("\n".join(visible_messages))
    return "\n\n".join(entries)


def _build_memory_generation_messages(
    session: AgentSession,
    runs: list[AgentRun],
) -> list[dict[str, str]]:
    existing_memory = _to_agent_session_memory_dto(session)
    existing_payload = json.dumps(existing_memory.model_dump(), ensure_ascii=False)
    conversation_excerpt = _format_runs_for_memory_prompt(runs)

    system_prompt = (
        "你是一个对话记忆整理器。"
        "你的任务是根据已有记忆和新增对话，输出用于后续会话承接的记忆 JSON。"
        "不要调用工具，不要输出解释，不要输出 Markdown，只输出一个 JSON 对象。"
        "不要记录任何邮箱、电话、密钥、口令、证件号、银行卡号等敏感信息。"
        "如果信息不稳定、不确定、一次性或与后续无关，就不要写入记忆。"
        "JSON 结构必须为："
        '{"summary":"",'
        '"preferences":[""],'
        '"facts":[""],'
        '"goals":[{"title":"","status":"active"}],'
        '"todos":[{"title":"","status":"open","dueHint":null,"sourceRunId":null}],'
        '"rules":[""],'
        '"status":"ready"}。'
    )
    user_prompt = (
        f"已有记忆：\n{existing_payload}\n\n"
        f"新增对话：\n{conversation_excerpt or '（无）'}\n\n"
        "要求：\n"
        "1. summary 控制在 800 字以内。\n"
        "2. 每个列表尽量保留高价值信息，避免重复。\n"
        "3. 只有明确承诺或稳定目标才写入 todos/goals。\n"
        "4. 只保留后续对话可能复用的事实、偏好和规则。\n"
        "5. 如果没有可写入内容，返回空列表和空 summary，status 仍为 ready。\n"
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
