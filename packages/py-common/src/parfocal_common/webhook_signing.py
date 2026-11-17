import hashlib
import hmac
from collections.abc import Iterable

TIMESTAMP_HEADER = "Parfocal-Timestamp"
SIGNATURE_HEADER = "Parfocal-Signature"
EVENT_ID_HEADER = "Parfocal-Event-Id"
EVENT_KIND_HEADER = "Parfocal-Event"
SEQUENCE_HEADER = "Parfocal-Sequence"
SCHEME = "v1="
MAX_SKEW_SECONDS = 300


def digest(secret: str, timestamp: int, body: bytes) -> str:
    signed = str(timestamp).encode() + b"." + body
    return hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()


def signature(secret: str, timestamp: int, body: bytes) -> str:
    return SCHEME + digest(secret, timestamp, body)


def signed_headers(secret: str, timestamp: int, body: bytes) -> dict[str, str]:
    return {
        TIMESTAMP_HEADER: str(timestamp),
        SIGNATURE_HEADER: signature(secret, timestamp, body),
    }


def verified(
    secrets: Iterable[str],
    timestamp: str | None,
    given: str | None,
    body: bytes,
    now: float,
    max_skew_seconds: int = MAX_SKEW_SECONDS,
) -> bool:
    if timestamp is None or given is None or not timestamp.isdigit():
        return False
    moment = int(timestamp)
    if abs(now - moment) > max_skew_seconds:
        return False
    return any(hmac.compare_digest(signature(secret, moment, body), given) for secret in secrets)
