from __future__ import annotations

from fastapi import Request


def split_csv_values(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        result.extend(item.strip() for item in value.split(",") if item.strip())
    return result


def get_csv_list_query_param(request: Request, name: str) -> list[str] | None:
    values = split_csv_values(request.query_params.getlist(name))
    return values or None


def get_scalar_or_csv_list_query_param(request: Request, name: str) -> str | list[str] | None:
    raw_values = request.query_params.getlist(name)
    if not raw_values:
        return None
    if len(raw_values) == 1:
        values = split_csv_values(raw_values)
        if not values:
            return None
        if "," not in raw_values[0] and len(values) == 1:
            return values[0]
        return values
    values = split_csv_values(raw_values)
    return values or None


def get_query_param(request: Request, name: str, default: str | int | None = None) -> str | int | None:
    return request.query_params.get(name, default)
