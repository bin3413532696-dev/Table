from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Literal
from urllib.parse import unquote
from uuid import UUID

from app.core.config import Settings
from app.core.session import is_signed_token, verify_session_token
from fastapi import Request

UserSource = Literal["default", "header", "signed_session", "missing"]


@dataclass(frozen=True)
class UserContext:
    user_id: str
    source: UserSource


_user_context: ContextVar[UserContext | None] = ContextVar("user_context", default=None)
USER_ID_HEADER = "x-user-id"
DEV_SESSION_COOKIE = "table_dev_session_user_id"


def _read_cookie_value(request: Request, cookie_name: str) -> str | None:
    value = request.cookies.get(cookie_name)
    if not value:
        return None
    try:
        return unquote(value)
    except Exception:
        return value


def resolve_request_user_context(request: Request, settings: Settings) -> UserContext:
    cookie_value = _read_cookie_value(request, DEV_SESSION_COOKIE)
    if cookie_value and is_signed_token(cookie_value):
        verified_user_id = verify_session_token(cookie_value, settings.provider_secret_key)
        if verified_user_id:
            return UserContext(user_id=verified_user_id, source="signed_session")

    header_value = request.headers.get(USER_ID_HEADER)
    if header_value and settings.trust_user_id_header:
        return UserContext(user_id=header_value.strip(), source="header")
    return UserContext(user_id=settings.default_user_id, source="missing")


def set_user_context(context: UserContext) -> Token[UserContext | None]:
    return _user_context.set(context)


def reset_user_context(token: Token[UserContext | None]) -> None:
    _user_context.reset(token)


def get_user_context(settings: Settings) -> UserContext:
    return _user_context.get() or UserContext(user_id=settings.default_user_id, source="missing")


def validate_user_id(raw_user_id: str) -> None:
    UUID(raw_user_id)
