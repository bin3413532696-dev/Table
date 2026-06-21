from fastapi import Request

from app.core.config import Settings
from app.core.csrf import CSRF_COOKIE_NAME, CSRF_HEADER_NAME, validate_csrf_token
from app.core.session import sign_session_token
from app.core.user_context import DEV_SESSION_COOKIE, resolve_request_user_context


def make_request(headers: list[tuple[bytes, bytes]]) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/tasks/",
        "headers": headers,
    }
    return Request(scope)


def test_resolve_user_context_prefers_header_when_trusted() -> None:
    request = make_request([(b"x-user-id", b"00000000-0000-0000-0000-000000000002")])
    settings = Settings(
        DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/table_dev",
        TRUST_USER_ID_HEADER=True,
    )
    context = resolve_request_user_context(request, settings)
    assert context.user_id == "00000000-0000-0000-0000-000000000002"
    assert context.source == "header"


def test_resolve_user_context_prefers_signed_session_cookie() -> None:
    settings = Settings(
        DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/table_dev",
        TRUST_USER_ID_HEADER=True,
        PROVIDER_SECRET_KEY="table-dev-provider-secret-key-change-me",
    )
    token = sign_session_token(
        "00000000-0000-0000-0000-000000000003",
        settings.provider_secret_key,
    )
    cookie = f"{DEV_SESSION_COOKIE}={token}".encode()
    request = make_request(
        [
            (b"cookie", cookie),
            (b"x-user-id", b"00000000-0000-0000-0000-000000000002"),
        ]
    )

    context = resolve_request_user_context(request, settings)
    assert context.user_id == "00000000-0000-0000-0000-000000000003"
    assert context.source == "signed_session"


def test_resolve_user_context_falls_back_to_header_for_invalid_signed_cookie() -> None:
    settings = Settings(
        DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/table_dev",
        TRUST_USER_ID_HEADER=True,
    )
    cookie = f"{DEV_SESSION_COOKIE}=invalid.token.value".encode()
    request = make_request(
        [
            (b"cookie", cookie),
            (b"x-user-id", b"00000000-0000-0000-0000-000000000002"),
        ]
    )

    context = resolve_request_user_context(request, settings)
    assert context.user_id == "00000000-0000-0000-0000-000000000002"
    assert context.source == "header"


def test_validate_csrf_token_requires_matching_cookie_and_header() -> None:
    cookie = f"{CSRF_COOKIE_NAME}=token-value".encode()
    request = make_request([(b"cookie", cookie), (CSRF_HEADER_NAME.encode(), b"token-value")])
    assert validate_csrf_token(request) is True
