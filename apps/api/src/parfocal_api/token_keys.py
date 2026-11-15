import base64
import binascii

from pydantic import SecretStr

MIN_KEY_BYTES = 32
KEY_SEPARATOR = ","


def decoded_key(secret: str) -> bytes:
    text = secret.replace("+", "-").replace("/", "_").rstrip("=")
    return base64.b64decode(text + "=" * (-len(text) % 4), altchars=b"-_", validate=True)


def key_bytes(secret: str) -> bytes | None:
    try:
        key = decoded_key(secret)
    except binascii.Error:
        return None
    return key if len(key) >= MIN_KEY_BYTES else None


def listed_keys(value: str) -> list[str]:
    return [part.strip() for part in value.split(KEY_SEPARATOR) if part.strip()]


def usable_keys(key: SecretStr | None) -> list[str] | None:
    if key is None:
        return None
    keys = listed_keys(key.get_secret_value())
    if not keys or any(key_bytes(secret) is None for secret in keys):
        return None
    return keys
