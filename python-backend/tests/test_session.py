from app.core.session import sign_session_token, verify_session_token


def test_sign_and_verify_session_token_round_trip() -> None:
    secret = "table-dev-provider-secret-key-change-me"
    token = sign_session_token("00000000-0000-0000-0000-000000000001", secret)
    assert verify_session_token(token, secret) == "00000000-0000-0000-0000-000000000001"


def test_verify_session_token_rejects_expired_token() -> None:
    secret = "table-dev-provider-secret-key-change-me"
    token = sign_session_token("00000000-0000-0000-0000-000000000001", secret, ttl_seconds=-1)
    assert verify_session_token(token, secret) is None


def test_verify_session_token_rejects_tampered_signature() -> None:
    secret = "table-dev-provider-secret-key-change-me"
    token = sign_session_token("00000000-0000-0000-0000-000000000001", secret)
    tampered = f"{token[:-1]}A"
    assert verify_session_token(tampered, secret) is None
