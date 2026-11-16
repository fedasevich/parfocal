import json
import os
import subprocess
import sys
from pathlib import Path

from require_support import VARIABLE

TESTS = Path(__file__).resolve().parent

CONFTEST = """
from require_support import pytest_configure, pytest_make_collect_report, pytest_runtest_makereport
"""

RECORDER = """
import json
import os

OUTCOMES = {}

def outcome(report):
    return "xfailed" if hasattr(report, "wasxfail") else report.outcome

def pytest_runtest_logreport(report):
    if report.when == "call" or report.outcome != "passed":
        OUTCOMES[report.nodeid.split("::")[-1]] = outcome(report)

def pytest_collectreport(report):
    if report.outcome != "passed":
        OUTCOMES[report.nodeid] = report.outcome

def pytest_unconfigure(config):
    with open(os.environ["OUTCOMES_FILE"], "w") as file:
        file.write(json.dumps(OUTCOMES))
"""

SKIPS = """
import pytest

def test_missing_weight():
    pytest.skip("encoder.onnx not in the export folder")

@pytest.mark.skipif(True, reason="TNBC is not in the dataset cache")
def test_missing_dataset():
    pass

@pytest.mark.xfail(reason="known gap", strict=True)
def test_known_gap():
    raise AssertionError

def test_present():
    pass
"""

MODULE_SKIP = """
import pytest

pytest.importorskip("a_module_nobody_installed")

def test_never_collected():
    pass
"""


def run(folder: Path, value: str | None, *options: str) -> tuple[int, dict[str, str], str]:
    env = {key: item for key, item in os.environ.items() if key != VARIABLE}
    if value is not None:
        env[VARIABLE] = value
    plugins = folder.parent / "plugins"
    plugins.mkdir(exist_ok=True)
    (plugins / "record_outcomes.py").write_text(RECORDER)
    report = plugins / "outcomes.json"
    report.unlink(missing_ok=True)
    env["OUTCOMES_FILE"] = str(report)
    env["PYTHONPATH"] = os.pathsep.join([str(TESTS), str(plugins)])
    command = [sys.executable, "-m", "pytest", "-p", "record_outcomes", "-p", "no:cacheprovider"]
    done = subprocess.run(
        [*command, "-q", *options, str(folder)],
        cwd=folder,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    outcomes = json.loads(report.read_text()) if report.exists() else {}
    return done.returncode, outcomes, done.stdout + done.stderr


def suite(tmp_path: Path) -> Path:
    folder = tmp_path / "suite"
    folder.mkdir()
    (folder / "conftest.py").write_text(CONFTEST)
    (folder / "test_skips.py").write_text(SKIPS)
    (folder / "test_module_skip.py").write_text(MODULE_SKIP)
    return folder


def test_missing_files_skip_without_the_variable(tmp_path: Path):
    code, outcomes, _ = run(suite(tmp_path), None)
    assert code == 0
    assert outcomes["test_missing_weight"] == "skipped"
    assert outcomes["test_missing_dataset"] == "skipped"
    assert outcomes["test_module_skip.py"] == "skipped"
    assert outcomes["test_present"] == "passed"


def test_missing_files_fail_with_the_variable(tmp_path: Path):
    code, outcomes, output = run(suite(tmp_path), "1", "--continue-on-collection-errors")
    assert code == 1
    assert outcomes["test_missing_weight"] == "failed"
    assert outcomes["test_missing_dataset"] == "failed"
    assert outcomes["test_module_skip.py"] == "failed"
    assert outcomes["test_known_gap"] == "xfailed"
    assert outcomes["test_present"] == "passed"
    assert "encoder.onnx not in the export folder" in output
    assert "TNBC is not in the dataset cache" in output
    assert f"{VARIABLE} is set" in output


def test_a_module_skip_stops_the_run_with_the_variable(tmp_path: Path):
    code, outcomes, output = run(suite(tmp_path), "1")
    assert code == 2
    assert outcomes["test_module_skip.py"] == "failed"
    assert "a_module_nobody_installed" in output


def test_zero_keeps_skipping(tmp_path: Path):
    code, outcomes, _ = run(suite(tmp_path), "0")
    assert code == 0
    assert outcomes["test_missing_weight"] == "skipped"


def test_deselecting_the_weights_marker_is_refused(tmp_path: Path):
    code, _, output = run(suite(tmp_path), "1", "-m", "not db and not weights")
    assert code == 4
    assert "-m 'not db'" in output
