import pytest

from parfocal_common.ingest import (
    FAILURES,
    Failure,
    FailureClass,
    Refusal,
    failure_class,
    failure_message,
)
from parfocal_common.result_imports import ImportFailure

RETRY_TO_FIX = [
    Failure.UPLOAD_MISSING,
    Failure.SIZE_MISMATCH,
    Failure.UPLOAD_ABORTED,
    Failure.UPLOAD_EXPIRED,
    Failure.CHECK_STOPPED,
    Refusal.TRUNCATED,
]


@pytest.mark.parametrize("code", RETRY_TO_FIX)
def test_a_file_that_may_pass_when_sent_again_is_transient(code: str) -> None:
    assert failure_class(code) is FailureClass.TRANSIENT


@pytest.mark.parametrize(
    "code",
    [
        *(refusal for refusal in Refusal if refusal not in RETRY_TO_FIX),
        *ImportFailure,
        "a-code-from-a-newer-worker",
    ],
)
def test_a_file_that_will_not_pass_again_is_permanent(code: str) -> None:
    assert failure_class(code) is FailureClass.PERMANENT


def test_every_known_failure_has_its_own_readable_message() -> None:
    assert all(
        failure_message(code) != failure_message("a-code-from-a-newer-worker") for code in FAILURES
    )
    assert all(
        not message.startswith("result-") and "_" not in message for message in FAILURES.values()
    )
