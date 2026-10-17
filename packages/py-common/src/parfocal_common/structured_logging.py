import json
import logging
import sys
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, TextIO

from parfocal_common.scrubbing import (
    REDACTED,
    STANDARD_RECORD_FIELDS,
    ScrubbingFilter,
    SensitiveValues,
)

CONTEXT_FIELDS = ("request_id", "tenant_id", "user_id")


@dataclass
class LogContext:
    request_id: str
    tenant_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    sensitive: SensitiveValues = field(default_factory=SensitiveValues)


_current: ContextVar[LogContext | None] = ContextVar("parfocal_log_context", default=None)
_outside = SensitiveValues()


def current_context() -> LogContext | None:
    return _current.get()


@contextmanager
def log_context(request_id: str | None = None) -> Generator[LogContext]:
    context = LogContext(request_id=request_id or uuid.uuid4().hex)
    token = _current.set(context)
    try:
        yield context
    finally:
        _current.reset(token)


def bind(*, tenant_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None) -> None:
    context = _current.get()
    if context is None:
        return
    if tenant_id is not None:
        context.tenant_id = tenant_id
    if user_id is not None:
        context.user_id = user_id


def register_sensitive(*values: str | None) -> None:
    context = _current.get()
    if context is not None:
        context.sensitive.register(*(value for value in values if value))


class ContextSensitiveValues(SensitiveValues):
    def _active(self) -> SensitiveValues:
        context = _current.get()
        return context.sensitive if context is not None else _outside

    def register(self, *values: str) -> None:
        self._active().register(*values)

    def clear(self) -> None:
        self._active().clear()

    def redact(self, text: str) -> str:
        return self._active().redact(text)


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        context = _current.get()
        if context is not None:
            for name in CONTEXT_FIELDS:
                value = getattr(context, name)
                if value is not None and not hasattr(record, name):
                    setattr(record, name, str(value))
        return True


class JsonFormatter(logging.Formatter):
    def __init__(self, service: str, environment: str) -> None:
        super().__init__()
        self._service = service
        self._environment = environment

    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
            "service": self._service,
            "environment": self._environment,
        }
        for name, value in record.__dict__.items():
            if name not in STANDARD_RECORD_FIELDS and name not in line:
                line[name] = value
        if record.exc_text:
            line["exception"] = record.exc_text
        if record.stack_info:
            line["stack"] = record.stack_info
        return json.dumps(line, default=lambda _: REDACTED, ensure_ascii=False)


class StructuredHandler(logging.StreamHandler[TextIO]):
    def __init__(self, service: str, environment: str, stream: TextIO) -> None:
        super().__init__(stream)
        self.addFilter(ContextFilter())
        self.addFilter(ScrubbingFilter(ContextSensitiveValues()))
        self.setFormatter(JsonFormatter(service, environment))


def configure_logging(
    service: str, environment: str, stream: TextIO | None = None, level: int = logging.INFO
) -> StructuredHandler:
    handler = StructuredHandler(service, environment, stream or sys.stdout)
    root = logging.getLogger()
    for existing in list(root.handlers):
        if isinstance(existing, StructuredHandler):
            root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(level)
    return handler
