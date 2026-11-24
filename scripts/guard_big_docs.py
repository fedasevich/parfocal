import json
import re
import shlex
import sys
from pathlib import Path
from typing import cast

BIG_DOCS = ("BACKLOG.md", "log.md")
WHOLE_READERS = {"cat", "less", "more", "bat", "head", "tail", "nl"}
MAX_LINES = 150
SED_RANGE = re.compile(r"^(\d+),(\d+)p$")
ADVICE = (
    "docs/BACKLOG.md and docs/log.md are too big to read whole. Use "
    "`python3 scripts/board.py show ID`, `find WORDS`, `recent N` or `brief`, "
    "`grep -n` for one line, `sed -n 'A,Bp'` for at most 150 lines, "
    "and `board.py note` and `board.py tick` to write."
)
RESULT_BYTES = 20_000
RESULT_ADVICE = (
    "This result file is over 20 KB, too big to read whole. Read its summary and findings "
    "table with `sed -n '1,60p'`, find the finding you need with `grep -n`, then read only "
    "that part with `sed -n 'A,Bp'` for at most 150 lines."
)


def names_big_result(token: str, cwd: str) -> bool:
    if "docs/results/" not in token or not token.endswith(".md"):
        return False
    try:
        return (Path(cwd) / token).stat().st_size > RESULT_BYTES
    except OSError:
        return False


def names_big_doc(token: str, cwd: str = "") -> bool:
    named = token.rsplit("/", 1)[-1] in BIG_DOCS and ("docs/" in token or "/" not in token)
    return named or names_big_result(token, cwd)


def segment_reads_too_much(tokens: list[str], cwd: str = "") -> bool:
    if not tokens or not any(names_big_doc(token, cwd) for token in tokens):
        return False
    program = tokens[0].rsplit("/", 1)[-1]
    if program in WHOLE_READERS:
        return True
    if program != "sed" or "-i" in tokens:
        return False
    if "-n" not in tokens:
        return True
    ranges = [SED_RANGE.match(token) for token in tokens]
    spans = [int(match.group(2)) - int(match.group(1)) for match in ranges if match]
    return not spans or max(spans) > MAX_LINES


def command_reads_too_much(command: str, cwd: str = "") -> bool:
    for segment in re.split(r"&&|\|\||[|;\n]", command):
        try:
            tokens = shlex.split(segment)
        except ValueError:
            tokens = segment.split()
        if segment_reads_too_much(tokens, cwd):
            return True
    return False


def read_reads_too_much(tool_input: dict[str, object], cwd: str = "") -> bool:
    path = str(tool_input.get("file_path", ""))
    if not names_big_doc(path, cwd):
        return False
    limit = tool_input.get("limit")
    return not isinstance(limit, int) or limit > MAX_LINES


def blocked(event: dict[str, object]) -> bool:
    raw_input = event.get("tool_input")
    if not isinstance(raw_input, dict):
        return False
    tool_input = cast("dict[str, object]", raw_input)
    cwd = str(event.get("cwd") or "")
    if event.get("tool_name") == "Bash":
        return command_reads_too_much(str(tool_input.get("command", "")), cwd)
    if event.get("tool_name") == "Read":
        return read_reads_too_much(tool_input, cwd)
    return False


def main() -> int:
    event = cast("dict[str, object]", json.load(sys.stdin))
    if blocked(event):
        about_result = "docs/results/" in json.dumps(event.get("tool_input"))
        print(RESULT_ADVICE if about_result else ADVICE, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
