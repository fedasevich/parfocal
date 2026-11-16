import os
from collections.abc import Generator

import pytest

VARIABLE = "PARFOCAL_REQUIRE_WEIGHTS"


def required() -> bool:
    return os.environ.get(VARIABLE, "").strip() not in {"", "0"}


def skip_reason(longrepr: object) -> str:
    if isinstance(longrepr, tuple) and len(longrepr) == 3:
        return str(longrepr[2])
    return str(longrepr)


def failed_instead(report: pytest.TestReport | pytest.CollectReport) -> None:
    reason = skip_reason(report.longrepr).removeprefix("Skipped: ")
    report.outcome = "failed"
    report.longrepr = f"{VARIABLE} is set, so this skip fails: {reason}"


def pytest_configure(config: pytest.Config) -> None:
    if required() and "not weights" in (config.option.markexpr or ""):
        message = f"{VARIABLE} is set, so run with -m 'not db' to keep the weights tests"
        raise pytest.UsageError(message)


@pytest.hookimpl(wrapper=True)
def pytest_runtest_makereport(
    item: pytest.Item, call: pytest.CallInfo[None]
) -> Generator[None, pytest.TestReport, pytest.TestReport]:
    report = yield
    if required() and report.skipped and not hasattr(report, "wasxfail"):
        failed_instead(report)
    return report


@pytest.hookimpl(wrapper=True)
def pytest_make_collect_report(
    collector: pytest.Collector,
) -> Generator[None, pytest.CollectReport, pytest.CollectReport]:
    report = yield
    if required() and report.skipped:
        failed_instead(report)
    return report
