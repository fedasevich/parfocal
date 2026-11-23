import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import cast

from guard_images import reader_key

COUNTS = Path(tempfile.gettempdir()) / "parfocal-check-runs"
E2E = re.compile(r"\bplaywright test\b|\btest:e2e\b")
VERIFY = re.compile(r"\b(?:bash|sh)\s+\S*verify-changed\.sh")
CHECKS = (
    ("verify", VERIFY, "PARFOCAL_VERIFY_FREE_RUNS", 3, 3),
    ("playwright", E2E, "PARFOCAL_E2E_FREE_RUNS", 10, 10),
)
ADVICE = {
    "verify": (
        "This agent has already run verify-changed.sh {runs} times. Each run costs minutes and "
        "the rule is three per task. Read the last failure, fix it and run only the failing "
        "test file or lint command. Send the same command again only for the final check "
        "before the commit, and it will run."
    ),
    "playwright": (
        "This agent has already run Playwright {runs} times. Stop rerunning to see what "
        "happens. Read the error context file of the last failure, fix the cause and run one "
        "spec with `-g` for the one test. Send the same command again if a run is truly "
        "needed, and it will run."
    ),
}


def check_kind(event: dict[str, object]) -> str | None:
    raw_input = event.get("tool_input")
    if event.get("tool_name") != "Bash" or not isinstance(raw_input, dict):
        return None
    command = str(cast("dict[str, object]", raw_input).get("command", ""))
    for kind, pattern, _, _, _ in CHECKS:
        if pattern.search(command):
            return kind
    return None


def pause_message(event: dict[str, object], counts: Path, free: dict[str, int]) -> str | None:
    kind = check_kind(event)
    if kind is None:
        return None
    every = next(step for name, _, _, _, step in CHECKS if name == kind)
    counts.mkdir(parents=True, exist_ok=True)
    counter = counts / f"{reader_key(event)}-{kind}"
    state = cast("dict[str, int]", json.loads(counter.read_text())) if counter.exists() else {}
    runs = state.get("runs", 0)
    paused_at = state.get("paused_at", -1)
    past_free = runs - free[kind]
    if past_free >= 0 and past_free % every == 0 and paused_at != runs:
        counter.write_text(json.dumps({"runs": runs, "paused_at": runs}))
        return ADVICE[kind].format(runs=runs)
    counter.write_text(json.dumps({"runs": runs + 1, "paused_at": paused_at}))
    return None


def free_runs() -> dict[str, int]:
    return {
        kind: int(os.environ.get(variable, default)) for kind, _, variable, default, _ in CHECKS
    }


def main() -> int:
    message = pause_message(json.load(sys.stdin), COUNTS, free_runs())
    if message is None:
        return 0
    print(message, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
