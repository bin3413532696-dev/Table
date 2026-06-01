from __future__ import annotations

from base64 import b64decode, b64encode
from hashlib import sha256

from app.core.config import Settings, get_settings

ENCRYPTION_VERSION = "v1"
IV_LENGTH = 12
AUTH_TAG_LENGTH = 16

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:  # pragma: no cover - exercised only when dependency is missing
    AESGCM = None


def _get_provider_key_material(settings: Settings | None = None) -> bytes:
    current = settings or get_settings()
    return sha256(current.provider_secret_key.encode("utf-8")).digest()


def is_encrypted_provider_secret(value: str) -> bool:
    return value.startswith(f"{ENCRYPTION_VERSION}:")


def encrypt_provider_secret(value: str, settings: Settings | None = None) -> str:
    normalized = value.strip()
    if not normalized:
        return ""

    if is_encrypted_provider_secret(normalized):
        return normalized

    if AESGCM is None:
        raise RuntimeError("cryptography is required to encrypt provider secrets")

    from os import urandom

    iv = urandom(IV_LENGTH)
    aesgcm = AESGCM(_get_provider_key_material(settings))
    encrypted = aesgcm.encrypt(iv, normalized.encode("utf-8"), associated_data=None)
    ciphertext = encrypted[:-AUTH_TAG_LENGTH]
    auth_tag = encrypted[-AUTH_TAG_LENGTH:]
    return (
        f"{ENCRYPTION_VERSION}:{b64encode(iv).decode('utf-8')}:"
        f"{b64encode(auth_tag).decode('utf-8')}:{b64encode(ciphertext).decode('utf-8')}"
    )


def decrypt_provider_secret(value: str | None, settings: Settings | None = None) -> str:
    normalized = (value or "").strip()
    if not normalized:
        return ""

    if not is_encrypted_provider_secret(normalized):
        return normalized

    if AESGCM is None:
        return ""

    try:
        _, iv_base64, auth_tag_base64, encrypted_base64 = normalized.split(":")
    except ValueError:
        return ""

    try:
        iv = b64decode(iv_base64)
        auth_tag = b64decode(auth_tag_base64)
        encrypted = b64decode(encrypted_base64)
    except Exception:
        return ""

    if len(iv) != IV_LENGTH or len(auth_tag) != AUTH_TAG_LENGTH:
        return ""

    try:
        aesgcm = AESGCM(_get_provider_key_material(settings))
        decrypted = aesgcm.decrypt(iv, encrypted + auth_tag, associated_data=None)
    except Exception:
        return ""
    return decrypted.decode("utf-8")


def mask_provider_secret(value: str | None, settings: Settings | None = None) -> str:
    plain_text = decrypt_provider_secret(value, settings)
    if not plain_text:
        return ""
    return f"••••••••{plain_text[-4:]}"


def has_provider_secret(value: str | None, settings: Settings | None = None) -> bool:
    return decrypt_provider_secret(value, settings).strip() != ""
