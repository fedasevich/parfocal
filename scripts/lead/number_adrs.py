import re
import subprocess
import sys
from pathlib import Path

ADR = Path("docs/adr")


def references(name: str) -> list[str]:
    found = subprocess.run(["git", "grep", "-l", name], capture_output=True, text=True)
    return found.stdout.split()


def number_one(path: Path, number: str) -> None:
    renamed = ADR / (number + path.name[4:])
    subprocess.run(["git", "mv", str(path), str(renamed)], check=True)
    text = renamed.read_text()
    text = re.sub(r"^# XXXX\.", f"# {number}.", text, count=1, flags=re.MULTILINE)
    text = re.sub(r"^- Status: .*$", "- Status: Accepted", text, count=1, flags=re.MULTILINE)
    renamed.write_text(text)
    for file in references(path.name):
        target = Path(file)
        target.write_text(
            target.read_text().replace(path.name, renamed.name).replace("ADR XXXX", f"ADR {number}")
        )
    title = re.search(r"^# \d{4}\. (.+)$", text, re.MULTILINE)
    date = re.search(r"^- Date: (.+)$", text, re.MULTILINE)
    if title is None or date is None:
        sys.exit(f"{renamed} needs a '# NNNN. Title' line and a '- Date:' line")
    readme = ADR / "README.md"
    heading = title.group(1).rstrip(".")
    row = f"| [{number}]({renamed.name}) | {heading} | Accepted | {date.group(1)} |"
    readme.write_text(readme.read_text().rstrip("\n") + f"\n{row}\n")
    print(f"ADR {number}: {title.group(1)}")


def main() -> None:
    pending = sorted(ADR.glob("XXXX-*.md"))
    if not pending:
        return
    taken = max(int(p.name[:4]) for p in ADR.glob("[0-9][0-9][0-9][0-9]-*.md"))
    for offset, path in enumerate(pending, start=1):
        number_one(path, f"{taken + offset:04d}")


if __name__ == "__main__":
    main()
