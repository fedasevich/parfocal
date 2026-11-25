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


def participant_of(report: dict[str, Any]) -> str:
    pending = list(report.get("suites", []))
    while pending:
        suite = pending.pop(0)
        pending.extend(suite.get("suites", []))
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                notes = [
                    *test.get("annotations", []),
                    *(
                        note
                        for result in test.get("results", [])
                        for note in result.get("annotations", [])
                    ),
                ]
                for note in notes:
                    if note.get("type") == "participant":
                        return str(note.get("description", ""))
    return "not reached"


def render_prepared(report: dict[str, Any]) -> str:
    code = participant_of(report)
    steps = steps_of(report)
    rows = [
        f"| {step['title']} | {outcome_of(step)} | {round(step.get('duration', 0) / 1000)} s |"
        for step in steps
    ]
    reached = sum(1 for step in steps if step.get("error") is None)
    today = datetime.now(UTC).date().isoformat()
    return "\n".join(
        [
            f"# Result: a deployed dry run from Prepare to the thank you page reached "
            f"{reached} of {len(steps)} steps",
            "",
            f"- Date: {today}",
            "- Backlog: EXP-018 (the moderator prepares a participant project from the console)",
            "- Kind: deployed dry run",
            "- Environment: app.parfocal.eu, the deployed development app",
            f"- Data: one participant project, code {code}, fictional names only, no PHI",
            "",
            "## Method",
            "",
            "`scripts/study-prepare-dry-run.sh` ran `apps/web/smoke/study-prepare.spec.ts`, which "
            "signed in as the smoke account, read the code the participant page made, pressed "
            "Prepare the participant in the study console, switched to the study workspace when "
            "the console offered it, walked `/study` through every round 5 task answering each "
            "SEQ with 5, answered the last questions and reached the thank you page. It then "
            "ticked Dry run on the session in the console results, so the round does not count "
            "it, and removed the project from the console.",
            "",
            "## Results",
            "",
            "| Step | Outcome | Time |",
            "| --- | --- | --- |",
            *rows,
            "",
        ]
    )


def render_joined(report: dict[str, Any]) -> str:
    code = participant_of(report)
    steps = steps_of(report)
    rows = [
        f"| {step['title']} | {outcome_of(step)} | {round(step.get('duration', 0) / 1000)} s |"
        for step in steps
    ]
    reached = sum(1 for step in steps if step.get("error") is None)
    today = datetime.now(UTC).date().isoformat()
    return "\n".join(
        [
            f"# Result: a deployed dry run from one join link to the thank you page reached "
            f"{reached} of {len(steps)} steps",
            "",
            f"- Date: {today}",
            "- Backlog: EXP-020 (a prepared participant joins a remote moderated session by one "
            "link)",
            "- Kind: deployed dry run",
            "- Environment: app.parfocal.eu, the deployed development app",
            f"- Data: one participant project, code {code}, fictional names only, no PHI",
            "",
            "## Method",
            "",
            "`scripts/study-join-dry-run.sh` ran `apps/web/smoke/study-join.spec.ts`, which "
            "signed in as the smoke account, pressed Make a join link in the study console, "
            "opened the link in a fresh browser context with no sign in, walked `/study` "
            "through every round 5 task, answered the last questions and reached the thank you "
            "page. The console then showed the participant as finished, the session was ticked "
            "Dry run, and the project was removed from the console.",
            "",
            "## Results",
            "",
            "| Step | Outcome | Time |",
            "| --- | --- | --- |",
            *rows,
            "",
        ]
    )


def main() -> None:
    if sys.argv[1] == "--joined":
        report = json.loads(Path(sys.argv[2]).read_text())
        sys.stdout.write(render_joined(report))
        return
    if sys.argv[1] == "--prepared":
        report = json.loads(Path(sys.argv[2]).read_text())
        sys.stdout.write(render_prepared(report))
        return
    report_path, code, seed_seconds = sys.argv[1], sys.argv[2], sys.argv[3]
    report = json.loads(Path(report_path).read_text())
    sys.stdout.write(render(report, code, seed_seconds))


if __name__ == "__main__":
    main()
