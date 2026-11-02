import json
import re
import shlex
import sys
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


def names_big_doc(token: str) -> bool:
    return token.rsplit("/", 1)[-1] in BIG_DOCS and ("docs/" in token or "/" not in token)


def segment_reads_too_much(tokens: list[str]) -> bool:
    if not tokens or not any(names_big_doc(token) for token in tokens):
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


def command_reads_too_much(command: str) -> bool:
    for segment in re.split(r"&&|\|\||[|;\n]", command):
        try:
            tokens = shlex.split(segment)
        except ValueError:
            tokens = segment.split()
        if segment_reads_too_much(tokens):
            return True
    return False


def read_reads_too_much(tool_input: dict[str, object]) -> bool:
    path = str(tool_input.get("file_path", ""))
    if not names_big_doc(path):
        return False
    limit = tool_input.get("limit")
    return not isinstance(limit, int) or limit > MAX_LINES


def blocked(event: dict[str, object]) -> bool:
    raw_input = event.get("tool_input")
    if not isinstance(raw_input, dict):
        return False
    tool_input = cast("dict[str, object]", raw_input)
    if event.get("tool_name") == "Bash":
        return command_reads_too_much(str(tool_input.get("command", "")))
    if event.get("tool_name") == "Read":
        return read_reads_too_much(tool_input)
    return False


def main() -> int:
    if blocked(json.load(sys.stdin)):
        print(ADVICE, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
