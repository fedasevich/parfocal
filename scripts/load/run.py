import argparse
import csv
import os
import subprocess
import sys
from pathlib import Path

from load.target import TargetRefusedError, checked_target

SCENARIOS = {"api": "ApiUser", "tiles": "TileUser", "room": "RoomUser"}
LOCUSTFILE = Path(__file__).with_name("locustfile.py")
SCRIPTS = LOCUSTFILE.parent.parent
COLUMNS = ("Request Count", "Failure Count", "50%", "95%", "Max Response Time")


def parsed(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Locust scenarios against one origin")
    parser.add_argument("--origin", required=True)
    parser.add_argument("--scenarios", default="api,tiles,room")
    parser.add_argument("--users", type=int, default=1)
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--out", type=Path, default=Path("out/load"))
    options = parser.parse_args(argv)
    names = [name.strip() for name in options.scenarios.split(",") if name.strip()]
    unknown = [name for name in names if name not in SCENARIOS]
    if unknown or not names:
        parser.error(f"scenarios must be among {', '.join(SCENARIOS)}")
    options.scenarios = names
    return options


def stats_path(prefix: Path) -> Path:
    return prefix.with_name(f"{prefix.name}_stats.csv")


def stats_rows(prefix: Path) -> list[dict[str, str]]:
    path = stats_path(prefix)
    if not path.exists():
        return []
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def requests_made(rows: list[dict[str, str]]) -> int:
    return sum(int(row["Request Count"]) for row in rows if row["Name"] == "Aggregated")


def rounded(value: str) -> str:
    try:
        return str(round(float(value)))
    except ValueError:
        return value


def table(scenario: str, rows: list[dict[str, str]]) -> list[str]:
    lines = []
    for row in rows:
        request = " ".join(part for part in (row["Type"], row["Name"]) if part)
        numbers = " | ".join(rounded(row.get(column, "")) for column in COLUMNS)
        lines.append(f"| {scenario} | {request} | {numbers} |")
    return lines


def run(options: argparse.Namespace) -> int:
    origin = checked_target(options.origin, os.environ.get("PARFOCAL_LOAD_ALLOW_HOST"))
    options.out.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONPATH": str(SCRIPTS)}
    env.setdefault("PARFOCAL_LOAD_REALTIME_URL", origin)
    lines = [
        f"Load run against {origin}, {options.users} users for {options.seconds} s each",
        "",
        "| Scenario | Request | Count | Failures | p50 ms | p95 ms | max ms |",
        "|---|---|---|---|---|---|---|",
    ]
    skipped: list[str] = []
    worst = 0
    for scenario in options.scenarios:
        prefix = options.out / scenario
        stats_path(prefix).unlink(missing_ok=True)
        command = [
            sys.executable,
            "-m",
            "locust",
            "-f",
            str(LOCUSTFILE),
            "--headless",
            "--only-summary",
            "-u",
            str(options.users),
            "-r",
            str(options.users),
            "-t",
            f"{options.seconds}s",
            "--host",
            origin,
            "--csv",
            str(prefix),
            SCENARIOS[scenario],
        ]
        code = subprocess.run(command, env=env, check=False).returncode
        worst = max(worst, code)
        rows = stats_rows(prefix)
        if code == 0 and requests_made(rows) == 0:
            skipped.append(scenario)
            continue
        lines.extend(table(scenario, rows))
    for scenario in skipped:
        lines.append(f"\nSkipped {scenario}: it made no requests, so its settings are missing.")
    report = "\n".join(lines) + "\n"
    sys.stdout.write(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with Path(summary).open("a") as handle:
            handle.write(report)
    if worst:
        return worst
    return 3 if len(skipped) == len(options.scenarios) else 0


def main() -> None:
    try:
        sys.exit(run(parsed()))
    except TargetRefusedError as refused:
        sys.stderr.write(f"{refused}\n")
        sys.exit(2)


if __name__ == "__main__":
    main()
