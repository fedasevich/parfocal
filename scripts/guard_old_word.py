import re
import subprocess
import sys
from pathlib import Path

WORD = "verdict"
LAST_RENAME_REVISION = 111
MIGRATION = re.compile(r"^apps/api/migrations/versions/(\d{4})_")
EXEMPT_FILES = {
    "scripts/guard_old_word.py",
    "apps/api/src/parfocal_api/legacy_names.py",
    "AGENTS.md",
    "CHANGELOG.md",
    "docs/BACKLOG.md",
    "docs/README.md",
    "docs/decisions.md",
    "docs/knowledge/README.md",
    "docs/knowledge/agent-workflow.md",
    "docs/log.md",
}
EXEMPT_FOLDERS = ("docs/board/", "docs/results/")


def exempt(path: str) -> bool:
    if path in EXEMPT_FILES or path.startswith(EXEMPT_FOLDERS):
        return True
    migration = MIGRATION.match(path)
    return migration is not None and int(migration.group(1)) <= LAST_RENAME_REVISION


def found(root: Path) -> list[str]:
    search = subprocess.run(
        ["git", "grep", "-I", "-i", "-n", "--untracked", "-e", WORD],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    return [line for line in search.stdout.splitlines() if not exempt(line.split(":", 1)[0])]


def main() -> int:
    hits = found(Path.cwd())
    for hit in hits:
        print(hit)
    if hits:
        print(f'Use "decision" instead of the old word ({len(hits)} uses).', file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
