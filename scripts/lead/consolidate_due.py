import re
import sys
from datetime import date
from pathlib import Path

MAX_DAYS = 3
STAMP = re.compile(r"Last consolidated: (\d{4}-\d{2}-\d{2})")


def days_since(text: str, today: date) -> int | None:
    found = STAMP.search(text)
    return (today - date.fromisoformat(found.group(1))).days if found else None


def main() -> None:
    age = days_since(Path(sys.argv[1]).read_text(), date.today())
    if age is None or age > MAX_DAYS:
        waited = "an unknown number of" if age is None else str(age)
        print(f"CONSOLIDATE DUE: {waited} days since the docs were consolidated, run /consolidate")


if __name__ == "__main__":
    main()
