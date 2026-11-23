import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def steps_of(report: dict[str, Any]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    pending = list(report.get("suites", []))
    while pending:
        suite = pending.pop(0)
        pending.extend(suite.get("suites", []))
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                for result in test.get("results", []):
                    found.extend(result.get("steps", []))
    return found


def outcome_of(step: dict[str, Any]) -> str:
    error = step.get("error")
    if error is None:
        return "reached"
    first = str(error.get("message", "")).strip().splitlines()
    return f"failed: {first[0][:120] if first else 'no message'}"


def render(report: dict[str, Any], code: str, seed_seconds: str) -> str:
    rows = [
        f"| {step['title']} | {outcome_of(step)} | {round(step.get('duration', 0) / 1000)} s |"
        for step in steps_of(report)
    ]
    reached = sum(1 for step in steps_of(report) if step.get("error") is None)
    today = datetime.now(UTC).date().isoformat()
    return "\n".join(
        [
            f"# Result: a deployed dry run of the round 5 tasks reached {reached} of 11 successes",
            "",
            f"- Date: {today}",
            "- Backlog: EXP-017 (every round 5 study task can be done in a fresh participant "
            "project)",
            "- Kind: deployed dry run",
            "- Environment: app.parfocal.eu, the deployed development app",
            f"- Data: one seeded participant project, code {code}, fictional names only, no PHI",
            "",
            "## Method",
            "",
            "`scripts/study-dry-run.sh` seeded the participant project through the EU seed "
            "function, then `apps/web/smoke/study-round5.spec.ts` signed in as the seat account "
            "and walked `/study` through all 11 tasks, answering each SEQ with 5.",
            "",
            "## Results",
            "",
            f"Seeding took {seed_seconds} s.",
            "",
            "| Task | Success | Time |",
            "| --- | --- | --- |",
            *rows,
            "",
        ]
    )


def main() -> None:
    report_path, code, seed_seconds = sys.argv[1], sys.argv[2], sys.argv[3]
    report = json.loads(Path(report_path).read_text())
    sys.stdout.write(render(report, code, seed_seconds))


if __name__ == "__main__":
    main()
