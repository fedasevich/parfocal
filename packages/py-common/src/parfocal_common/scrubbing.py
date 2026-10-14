import logging
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any, TypeIs

REDACTED = "[redacted]"

ALLOWED_FIELDS = frozenset(
    {
        "request_id",
        "trace_id",
        "span_id",
        "tenant_id",
        "user_id",
        "case_id",
        "slide_id",
        "study_id",
        "job_id",
        "event",
        "action",
        "method",
        "route",
        "status_code",
        "duration_ms",
        "error_type",
        "error_code",
        "environment",
        "service",
        "release",
        "count",
        "size_bytes",
    }
)

EVENT_DROPPED_KEYS = frozenset({"request", "extra", "server_name", "modules"})
EVENT_FIELD_KEYS = frozenset({"tags", "contexts"})
MINIMUM_SENSITIVE_LENGTH = 3

PATTERNS = (
    re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"),
    re.compile(r"\bBearer\s+[\w.~+/=-]+", re.IGNORECASE),
)

STANDARD_RECORD_FIELDS = frozenset(
    logging.makeLogRecord({}).__dict__.keys() | {"message", "asctime", "taskName"}
)


def is_mapping(value: object) -> TypeIs[Mapping[Any, Any]]:
    return isinstance(value, Mapping)


def is_sequence(value: object) -> TypeIs[Sequence[Any]]:
    return isinstance(value, Sequence)


def _phrase_pattern(value: str) -> str:
    return r"\s+".join(re.escape(word) for word in value.split())


def _compile(values: Iterable[str]) -> re.Pattern[str] | None:
    ordered = sorted(values, key=len, reverse=True)
    if not ordered:
        return None
    return re.compile("|".join(_phrase_pattern(value) for value in ordered), re.IGNORECASE)


class SensitiveValues:
    def __init__(self) -> None:
        self._values: frozenset[str] = frozenset()
        self._pattern: re.Pattern[str] | None = None

    def register(self, *values: str) -> None:
        normalised = {" ".join(value.split()).casefold() for value in values}
        kept = {value for value in normalised if len(value) >= MINIMUM_SENSITIVE_LENGTH}
        self._values = self._values | kept
        self._pattern = _compile(self._values)

    def clear(self) -> None:
        self._values = frozenset()
        self._pattern = None

    def redact(self, text: str) -> str:
        pattern = self._pattern
        result = text if pattern is None else pattern.sub(REDACTED, text)
        for fixed in PATTERNS:
            result = fixed.sub(REDACTED, result)
        return result


def redact_tree(value: Any, sensitive: SensitiveValues) -> Any:
    if isinstance(value, str):
        return sensitive.redact(value)
    if is_mapping(value):
        return {str(key): redact_tree(item, sensitive) for key, item in value.items()}
    if is_sequence(value):
        return [redact_tree(item, sensitive) for item in value]
    if value is None or isinstance(value, bool | int | float):
        return value
    return sensitive.redact(str(value))


def scrub_fields(fields: Mapping[str, Any], sensitive: SensitiveValues) -> dict[str, Any]:
    return {
        key: redact_tree(value, sensitive) if key in ALLOWED_FIELDS else REDACTED
        for key, value in fields.items()
    }


def scrub_attributes(
    attributes: Mapping[str, Any] | None, sensitive: SensitiveValues
) -> dict[str, Any]:
    return scrub_fields(attributes or {}, sensitive)


def _scrub_user(user: Any, sensitive: SensitiveValues) -> dict[str, Any]:
    if not is_mapping(user):
        return {}
    identifier = user.get("id")
    if identifier is None:
        return {}
    return {"id": redact_tree(identifier, sensitive)}


def scrub_event(event: Mapping[str, Any], sensitive: SensitiveValues) -> dict[str, Any]:
    scrubbed: dict[str, Any] = {}
    for key, value in event.items():
        if key in EVENT_DROPPED_KEYS:
            continue
        if key == "user":
            scrubbed[key] = _scrub_user(value, sensitive)
        elif key in EVENT_FIELD_KEYS and is_mapping(value):
            scrubbed[key] = scrub_fields(value, sensitive)
        else:
            scrubbed[key] = redact_tree(value, sensitive)
    return scrubbed


def sentry_before_send(
    sensitive: SensitiveValues,
) -> Callable[[dict[str, Any], object], dict[str, Any]]:
    def before_send(event: dict[str, Any], hint: object) -> dict[str, Any]:
        del hint
        return scrub_event(event, sensitive)

    return before_send


class ScrubbingFilter(logging.Filter):
    def __init__(self, sensitive: SensitiveValues) -> None:
        super().__init__()
        self._sensitive = sensitive

    def filter(self, record: logging.LogRecord) -> bool:
        fields = record.__dict__
        record.msg = self._sensitive.redact(record.getMessage())
        record.args = None
        for key in [name for name in fields if name not in STANDARD_RECORD_FIELDS]:
            fields[key] = (
                redact_tree(fields[key], self._sensitive) if key in ALLOWED_FIELDS else REDACTED
            )
        self._scrub_exception(record)
        return True

    def _scrub_exception(self, record: logging.LogRecord) -> None:
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        record.exc_info = None
        if record.exc_text:
            record.exc_text = self._sensitive.redact(record.exc_text)
        if record.stack_info:
            record.stack_info = self._sensitive.redact(record.stack_info)
