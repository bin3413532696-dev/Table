from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime

DEFAULT_SESSION_TITLE = "新会话"
ACTIVE_AGENT_RUN_STATUSES = {"running", "waiting_confirmation"}
KNOWN_RUN_STATUSES = {
    "pending",
    "running",
    "waiting_confirmation",
    "completed",
    "failed",
    "cancelled",
}
SUPPORTED_STREAM_PROVIDER_FORMATS = {"anthropic", "openai", "gemini", "custom"}
ANTHROPIC_API_VERSION = "2023-06-01"
PENDING_CONFIRMATION_TOOL_ID = "pending-confirmation"
PENDING_CONFIRMATION_TOOL_NAME = "pending_confirmation"
MAX_AGENT_ITERATIONS = 5
TOOL_BLOCK_REGEX = re.compile(r"```tool\s*\n?([\s\S]*?)```", re.IGNORECASE)
JSON_BLOCK_REGEX = re.compile(r"```json\s*\n?([\s\S]*?)```", re.IGNORECASE)


@dataclass(frozen=True)
class AgentToolCall:
    id: str
    name: str
    arguments: dict[str, object]


@dataclass(frozen=True)
class AgentModelRuntimeConfig:
    api_format: str
    api_key: str
    base_url: str
    model: str
    timeout_ms: int
    headers: dict[str, str]
    provider_id: str
    provider_name: str


def _now() -> datetime:
    return datetime.now(UTC)


def _timestamp_ms(value: datetime | None) -> int:
    return int((value or _now()).timestamp() * 1000)


def _iso_timestamp(value: datetime | None = None) -> str:
    return (value or _now()).isoformat()


def _normalize_run_status(value: str) -> str:
    return value if value in KNOWN_RUN_STATUSES else "pending"


def _normalize_model(payload_model: str, provider_model: str | None) -> str:
    if payload_model != "default":
        return payload_model
    return (provider_model or "").strip() or "default"


def _generate_session_title(input_text: str) -> str:
    trimmed = input_text.strip()
    if not trimmed:
        return DEFAULT_SESSION_TITLE
    if len(trimmed) <= 40:
        return trimmed
    return f"{trimmed[:40]}..."


def _normalize_task_priority(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    priority_map = {
        "low": "low",
        "medium": "medium",
        "high": "high",
        "l": "low",
        "m": "medium",
        "h": "high",
        "low priority": "low",
        "medium priority": "medium",
        "high priority": "high",
        "低": "low",
        "低优先级": "low",
        "中": "medium",
        "中等": "medium",
        "中优先级": "medium",
        "默认": "medium",
        "高": "high",
        "高优先级": "high",
        "重要": "high",
        "紧急": "high",
    }
    return priority_map.get(normalized)


def _string_or_none(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _to_string_record(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if isinstance(key, str) and isinstance(item, str)}


def _content_to_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
            continue
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if isinstance(text, str):
            parts.append(text)
    return "".join(parts)
