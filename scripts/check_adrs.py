import re
import sys
from pathlib import Path

ADR_FILE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")
STATUS_LINE = re.compile(r"^- Status: (.+)$", re.MULTILINE)
SUPERSEDED = re.compile(r"^Superseded by (\d{4})$")
PLAIN_STATUSES = {"Proposed", "Accepted", "Rejected"}


def adr_files(adr_dir: Path) -> dict[str, Path]:
    return {
        match.group(1): path
        for path in sorted(adr_dir.iterdir())
        if (match := ADR_FILE.match(path.name))
    }


def status_problems(number: str, path: Path, known: set[str]) -> list[str]:
    statuses = STATUS_LINE.findall(path.read_text())
    if len(statuses) != 1:
        return [f"{path.name}: expected one '- Status:' line, found {len(statuses)}"]
    status = statuses[0].strip()
    if status in PLAIN_STATUSES:
        return []
    superseded = SUPERSEDED.match(status)
    if not superseded:
        return [f"{path.name}: unknown status '{status}'"]
    successor = superseded.group(1)
    if successor == number or successor not in known:
        return [f"{path.name}: superseded by missing record {successor}"]
    return []


def index_problems(adr_dir: Path, numbers: set[str]) -> list[str]:
    index = (adr_dir / "README.md").read_text()
    return [
        f"README.md: ADR {number} is not listed in the index"
        for number in sorted(numbers)
        if number != "0000" and f"[{number}](" not in index
    ]


def check(adr_dir: Path) -> list[str]:
    files = adr_files(adr_dir)
    known = set(files)
    problems = [
        problem
        for number, path in files.items()
        for problem in status_problems(number, path, known)
    ]
    return problems + index_problems(adr_dir, known)


def main() -> int:
    adr_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/adr")
    problems = check(adr_dir)
    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        return 1
    print(f"{len(adr_files(adr_dir))} ADRs checked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
