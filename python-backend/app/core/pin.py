from __future__ import annotations

import base64
import hashlib
import hmac
import os

SALT_LENGTH = 16
KEY_LENGTH = 32
SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1


def hash_pin(plain_pin: str) -> str:
    salt = os.urandom(SALT_LENGTH)
    digest = hashlib.scrypt(
        plain_pin.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=KEY_LENGTH,
    )
    return f"{base64.b64encode(salt).decode('utf-8')}:{base64.b64encode(digest).decode('utf-8')}"


def verify_pin(plain_pin: str, hashed_pin: str) -> bool:
    salt_b64, sep, digest_b64 = hashed_pin.partition(":")
    if not sep or not salt_b64 or not digest_b64:
        return False

    try:
        salt = base64.b64decode(salt_b64.encode("utf-8"))
        expected = base64.b64decode(digest_b64.encode("utf-8"))
        actual = hashlib.scrypt(
            plain_pin.encode("utf-8"),
            salt=salt,
            n=SCRYPT_N,
            r=SCRYPT_R,
            p=SCRYPT_P,
            dklen=len(expected),
        )
    except Exception:
        return False

    if len(actual) != len(expected):
        return False

    return hmac.compare_digest(actual, expected)
