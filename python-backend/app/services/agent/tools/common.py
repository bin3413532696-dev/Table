from __future__ import annotations

from app.services.agent._constants import _string_or_none


def string_arg(arguments: dict[str, object], key: str) -> str | None:
    return _string_or_none(arguments.get(key))


def int_arg(arguments: dict[str, object], key: str, default: int) -> int:
    try:
        value = int(arguments.get(key) or default)
    except (TypeError, ValueError):
        return default
    return max(value, 1)
