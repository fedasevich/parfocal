import re
import subprocess
import sys
from pathlib import Path

LIMIT = 1200
SOURCE = re.compile(r"\.(ts|tsx|js|jsx|mjs|cjs|py)$")
SKIPPED = re.compile(
    r"(^|/)(tests?|e2e|generated|fake-api|fixtures|poc)/"
    r"|\.(test|spec|stories|gen)\.[a-z]+$"
    r"|(^|/)test_[^/]*\.py$"
    r"|(^|/)apps/api/migrations/versions/"
)
EXCEPTIONS = {
    "apps/api/src/parfocal_api/clinical_reports.py",
    "apps/api/src/parfocal_api/threads.py",
    "apps/web/src/screens/upload/live-wizard.tsx",
}


def checked(path: str) -> bool:
    return SOURCE.search(path) is not None and SKIPPED.search(path) is None


def lengths(root: Path) -> dict[str, int]:
    listed = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    found: dict[str, int] = {}
    for path in listed.stdout.splitlines():
        file = root / path
        if checked(path) and file.is_file():
            found[path] = len(file.read_text(errors="replace").splitlines())
    return found


def problems(found: dict[str, int], exceptions: set[str]) -> list[str]:
    out: list[str] = []
    for path, count in sorted(found.items()):
        if count > LIMIT and path not in exceptions:
            out.append(f"{path} has {count} lines, more than {LIMIT}. Split it by domain.")
    for path in sorted(exceptions):
        if found.get(path, 0) <= LIMIT:
            out.append(f"{path} is no longer over {LIMIT} lines. Remove it from EXCEPTIONS.")
    return out


def main() -> int:
    found = problems(lengths(Path.cwd()), EXCEPTIONS)
    for line in found:
        print(line, file=sys.stderr)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
