import base64
import binascii

from pydantic import SecretStr

MIN_KEY_BYTES = 32


def decoded_key(secret: str) -> bytes:
    text = secret.replace("+", "-").replace("/", "_").rstrip("=")
    return base64.b64decode(text + "=" * (-len(text) % 4), altchars=b"-_", validate=True)


def key_bytes(secret: str) -> bytes | None:
    try:
        key = decoded_key(secret)
    except binascii.Error:
        return None
    return key if len(key) >= MIN_KEY_BYTES else None


def usable_secret(key: SecretStr | None) -> str | None:
    if key is None:
        return None
    secret = key.get_secret_value()
    return None if key_bytes(secret) is None else secret
