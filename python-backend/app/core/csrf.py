from secrets import token_hex

from fastapi import Request

CSRF_COOKIE_NAME = "table_dev_csrf_token"
CSRF_HEADER_NAME = "x-csrf-token"


def generate_csrf_token() -> str:
    return token_hex(32)


def request_has_csrf_cookie(request: Request) -> bool:
    return CSRF_COOKIE_NAME in request.cookies


def validate_csrf_token(request: Request) -> bool:
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    header_token = request.headers.get(CSRF_HEADER_NAME)
    return bool(cookie_token and header_token and cookie_token == header_token)
