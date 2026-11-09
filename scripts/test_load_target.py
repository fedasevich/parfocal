import pytest
from load.target import TargetRefusedError, checked_target


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8765",
        "http://127.0.0.1:5199/",
        "https://staging.parfocal.eu",
        "wss://staging-edge.parfocal.eu",
        "https://parfocal--staging-api.modal.run",
    ],
)
def test_local_and_staging_targets_pass(url: str) -> None:
    assert checked_target(url) == url.rstrip("/")


@pytest.mark.parametrize(
    "url",
    [
        None,
        "",
        "https://parfocal.eu",
        "https://app.parfocal.eu",
        "https://parfocal--main-api.modal.run",
        "ftp://localhost",
        "localhost:8000",
    ],
)
def test_production_and_unknown_targets_are_refused(url: str | None) -> None:
    with pytest.raises(TargetRefusedError):
        checked_target(url)


def test_an_exact_allowed_host_passes() -> None:
    assert checked_target("https://load.example.org/", "load.example.org") == (
        "https://load.example.org"
    )


def test_the_allowed_host_does_not_cover_other_hosts() -> None:
    with pytest.raises(TargetRefusedError):
        checked_target("https://app.parfocal.eu", "load.example.org")
