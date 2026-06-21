from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any


def now() -> datetime:
    return datetime.now(UTC)


def to_timestamp_date(value: object) -> datetime:
    if isinstance(value, (int, float)) and value > 0:
        return datetime.fromtimestamp(value / 1000, tz=UTC)
    return now()


def to_optional_due_date(value: object) -> date | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return date.fromisoformat(value)


def to_record_date(value: object) -> date:
    if isinstance(value, str) and value.strip():
        return date.fromisoformat(value)
    return now().date()


def normalize_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def normalize_imported_tasks(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = item.get("title")
        completed = item.get("completed")
        priority = item.get("priority")
        if not isinstance(title, str) or not title.strip():
            continue
        if not isinstance(completed, bool):
            continue
        if priority not in {"low", "medium", "high"}:
            continue
        normalized.append(item)
    return normalized


def normalize_imported_finance(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        finance_type = item.get("type")
        amount = item.get("amount")
        description = item.get("description")
        category = item.get("category")
        record_date = item.get("date")
        if finance_type not in {"income", "expense"}:
            continue
        if not isinstance(amount, (int, float)) or amount < 0:
            continue
        if not isinstance(description, str) or not description.strip():
            continue
        if not isinstance(category, str) or not category.strip():
            continue
        if not isinstance(record_date, str) or not record_date.strip():
            continue
        normalized.append(item)
    return normalized


def normalize_imported_notes(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = item.get("title")
        if not isinstance(title, str) or not title.strip():
            continue
        normalized.append(item)
    return normalized


def normalize_imported_preset_tags(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        normalized.append(item)
    return normalized
