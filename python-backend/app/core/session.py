from __future__ import annotations

import base64
import hashlib
import hmac
import time


def _get_signing_key(secret: str) -> bytes:
    return hashlib.sha256(secret.encode("utf-8")).digest()


def _compute_hmac(user_id: str, expires_at: int, secret: str) -> bytes:
    return hmac.new(
        _get_signing_key(secret),
        f"{user_id}.{expires_at}".encode(),
        hashlib.sha256,
    ).digest()


def sign_session_token(user_id: str, secret: str, ttl_seconds: int = 86400) -> str:
    expires_at = int(time.time()) + ttl_seconds
    signature = _compute_hmac(user_id, expires_at, secret)
    return f"{user_id}.{expires_at}.{base64.b64encode(signature).decode('utf-8')}"


def verify_session_token(token: str, secret: str) -> str | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None

    user_id, expires_at_raw, signature_b64 = parts
    try:
        expires_at = int(expires_at_raw)
    except ValueError:
        return None

    if expires_at <= 0 or int(time.time()) > expires_at:
        return None

    try:
        expected = _compute_hmac(user_id, expires_at, secret)
        actual = base64.b64decode(signature_b64.encode("utf-8"))
    except Exception:
        return None

    if len(actual) != len(expected):
        return None

    if not hmac.compare_digest(actual, expected):
        return None

    return user_id


def is_signed_token(value: str) -> bool:
    return value.count(".") == 2
