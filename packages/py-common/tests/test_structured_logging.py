import io
import json
import logging
import uuid
from collections.abc import Generator
from typing import Any

import pytest

from parfocal_common.structured_logging import (
    bind,
    configure_logging,
    log_context,
    register_sensitive,
)

TENANT = uuid.uuid4()
USER = uuid.uuid4()


@pytest.fixture
def output() -> Generator[io.StringIO]:
    stream = io.StringIO()
    handler = configure_logging("api", "test", stream=stream)
    yield stream
    logging.getLogger().removeHandler(handler)


def lines(stream: io.StringIO) -> list[dict[str, Any]]:
    return [json.loads(line) for line in stream.getvalue().splitlines()]


def test_a_patient_name_passed_to_a_logger_is_redacted(output: io.StringIO) -> None:
    with log_context("req-12345678"):
        bind(tenant_id=TENANT, user_id=USER)
        register_sensitive("Eva Testová", "MRN-4471", None)
        logging.getLogger("parfocal.test").warning(
            "Opened the case of %s, MRN %s",
            "EVA  testová",
            "mrn-4471",
            extra={"patient": "Eva Testová", "case_id": "c-1", "route": "Eva Testová"},
        )
    (line,) = lines(output)
    assert line["message"] == "Opened the case of [redacted], MRN [redacted]"
    assert (line["patient"], line["route"], line["case_id"]) == ("[redacted]", "[redacted]", "c-1")
    assert (line["request_id"], line["tenant_id"], line["user_id"]) == (
        "req-12345678",
        str(TENANT),
        str(USER),
    )
    assert (line["level"], line["service"], line["environment"]) == ("warning", "api", "test")
    assert "Eva" not in output.getvalue()


def test_names_stay_with_their_request(output: io.StringIO) -> None:
    with log_context():
        register_sensitive("Jana Nováková")
    with log_context():
        logging.getLogger("parfocal.test").info("Jana Nováková again")
    (line,) = lines(output)
    assert line["message"] == "Jana Nováková again"


def test_exceptions_and_emails_are_redacted_without_a_request(output: io.StringIO) -> None:
    try:
        raise ValueError("lookup failed for someone@example.test")
    except ValueError:
        logging.getLogger("parfocal.test").exception("failed")
    (line,) = lines(output)
    assert "someone@example.test" not in line["exception"]
    assert "[redacted]" in line["exception"]
    assert "request_id" not in line


def test_configuring_twice_keeps_one_handler(output: io.StringIO) -> None:
    second = io.StringIO()
    handler = configure_logging("api", "test", stream=second)
    logging.getLogger("parfocal.test").info("once")
    assert output.getvalue() == ""
    assert [json.loads(line)["message"] for line in second.getvalue().splitlines()] == ["once"]
    logging.getLogger().removeHandler(handler)
