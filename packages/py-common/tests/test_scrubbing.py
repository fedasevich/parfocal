import logging

import pytest

from parfocal_common.scrubbing import (
    REDACTED,
    ScrubbingFilter,
    SensitiveValues,
    scrub_attributes,
    scrub_event,
    sentry_before_send,
)

PATIENT_NAME = "Testa Examplova"


class Capture(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)
        self.lines.append(self.format(record))


@pytest.fixture
def sensitive() -> SensitiveValues:
    values = SensitiveValues()
    values.register(PATIENT_NAME)
    return values


@pytest.fixture
def capture(sensitive: SensitiveValues) -> Capture:
    handler = Capture()
    handler.addFilter(ScrubbingFilter(sensitive))
    return handler


@pytest.fixture
def logger(capture: Capture) -> logging.Logger:
    scratch = logging.getLogger("parfocal.test.scrubbing")
    scratch.handlers = [capture]
    scratch.setLevel(logging.INFO)
    scratch.propagate = False
    return scratch


def test_a_patient_name_in_a_log_line_is_redacted(logger: logging.Logger, capture: Capture) -> None:
    logger.info("opened case for %s", PATIENT_NAME)
    assert capture.lines == [f"opened case for {REDACTED}"]


def test_redaction_ignores_case_and_spacing(logger: logging.Logger, capture: Capture) -> None:
    logger.info("owner testa   EXAMPLOVA saved")
    assert capture.lines == [f"owner {REDACTED} saved"]


def test_a_name_in_an_exception_is_redacted(logger: logging.Logger, capture: Capture) -> None:
    try:
        raise ValueError(f"no match for {PATIENT_NAME}")
    except ValueError:
        logger.exception("lookup failed")
    assert PATIENT_NAME not in capture.lines[0]
    assert REDACTED in capture.lines[0]


def test_extra_fields_outside_the_allow_list_are_replaced(
    logger: logging.Logger, capture: Capture
) -> None:
    logger.info(
        "saved", extra={"request_id": "r-1", "patient_name": "anything", "tenant_id": "t-1"}
    )
    fields = capture.records[0].__dict__
    assert (fields["request_id"], fields["tenant_id"]) == ("r-1", "t-1")
    assert fields["patient_name"] == REDACTED


def test_allowed_fields_still_have_registered_strings_redacted(
    logger: logging.Logger, capture: Capture
) -> None:
    logger.info("saved", extra={"event": f"renamed {PATIENT_NAME}"})
    assert capture.records[0].__dict__["event"] == f"renamed {REDACTED}"


def test_emails_and_bearer_tokens_are_redacted_without_registration() -> None:
    text = SensitiveValues().redact("mail a.b@example.org with Bearer abc.def-123")
    assert text == f"mail {REDACTED} with {REDACTED}"


def test_short_values_are_not_registered() -> None:
    values = SensitiveValues()
    values.register("Al", "  ")
    assert values.redact("Al went to the lab") == "Al went to the lab"


def test_clear_forgets_registered_values(sensitive: SensitiveValues) -> None:
    sensitive.clear()
    assert sensitive.redact(PATIENT_NAME) == PATIENT_NAME


def test_span_attributes_keep_only_allow_listed_keys(sensitive: SensitiveValues) -> None:
    scrubbed = scrub_attributes(
        {"route": "/cases/{case_id}", "http.url": "/cases?q=Testa", "status_code": 200},
        sensitive,
    )
    assert scrubbed == {"route": "/cases/{case_id}", "http.url": REDACTED, "status_code": 200}


def test_span_attributes_may_be_missing(sensitive: SensitiveValues) -> None:
    assert scrub_attributes(None, sensitive) == {}


def sample_event() -> dict[str, object]:
    return {
        "message": f"failed for {PATIENT_NAME}",
        "level": "error",
        "exception": {"values": [{"type": "ValueError", "value": f"bad {PATIENT_NAME}"}]},
        "breadcrumbs": {"values": [{"message": f"opened {PATIENT_NAME}"}]},
        "request": {"url": "/patients?name=x", "data": {"name": PATIENT_NAME}},
        "extra": {"name": PATIENT_NAME},
        "tags": {"tenant_id": "t-1", "patient": PATIENT_NAME},
        "user": {"id": "u-1", "email": "a@example.org", "username": PATIENT_NAME},
    }


def test_sentry_events_are_scrubbed(sensitive: SensitiveValues) -> None:
    scrubbed = scrub_event(sample_event(), sensitive)
    assert "request" not in scrubbed
    assert "extra" not in scrubbed
    assert scrubbed["user"] == {"id": "u-1"}
    assert scrubbed["tags"] == {"tenant_id": "t-1", "patient": REDACTED}
    assert PATIENT_NAME not in repr(scrubbed)
    assert scrubbed["level"] == "error"


def test_sentry_before_send_returns_the_scrubbed_event(sensitive: SensitiveValues) -> None:
    before_send = sentry_before_send(sensitive)
    assert PATIENT_NAME not in repr(before_send(sample_event(), None))
