from app.core.pin import hash_pin, verify_pin


def test_hash_pin_and_verify_pin_round_trip() -> None:
    hashed = hash_pin("123456")
    assert verify_pin("123456", hashed) is True
    assert verify_pin("654321", hashed) is False


def test_verify_pin_rejects_invalid_hash_format() -> None:
    assert verify_pin("123456", "invalid") is False
