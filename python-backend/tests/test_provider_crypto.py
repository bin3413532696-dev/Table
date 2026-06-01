from app.core.config import Settings
from app.core.provider_crypto import (
    decrypt_provider_secret,
    encrypt_provider_secret,
    has_provider_secret,
    mask_provider_secret,
)


def test_provider_secret_round_trip() -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/table",
        provider_secret_key="table-dev-provider-secret-key-change-me",
    )

    encrypted = encrypt_provider_secret("secret-token", settings)

    assert encrypted.startswith("v1:")
    assert decrypt_provider_secret(encrypted, settings) == "secret-token"
    assert has_provider_secret(encrypted, settings) is True
    assert mask_provider_secret(encrypted, settings) == "••••••••oken"
