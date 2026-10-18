import bisect
import json
import re
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from enum import StrEnum
from importlib.resources import files
from pathlib import Path
from typing import Any, cast

from jsonschema import Draft202012Validator, ValidationError

SCHEMA_FILE = "parfocal-results-v1.schema.json"
TEMPLATE_FILE = "parfocal-results-v1.template.json"
WHITESPACE = re.compile(r"[ \t\n\r]*")
DECODER = json.JSONDecoder()

type JsonPath = tuple[str | int, ...]


class Code(StrEnum):
    NOT_JSON = "not-json"
    WRONG_FORMAT = "wrong-format"
    WRONG_VERSION = "wrong-version"
    MISSING_FIELD = "missing-field"
    UNKNOWN_FIELD = "unknown-field"
    WRONG_TYPE = "wrong-type"
    OUT_OF_RANGE = "out-of-range"
    BAD_LENGTH = "bad-length"
    NOT_ALLOWED = "not-allowed"
    BAD_PATTERN = "bad-pattern"


@dataclass(frozen=True)
class Problem:
    line: int
    path: str
    code: Code
    message: str


def schema_text() -> str:
    return files("parfocal_common.schemas").joinpath(SCHEMA_FILE).read_text()


def template_text() -> str:
    return files("parfocal_common.schemas").joinpath(TEMPLATE_FILE).read_text()


VALIDATOR: Any = Draft202012Validator(json.loads(schema_text()))


def positions(text: str) -> dict[JsonPath, int]:
    breaks = [index for index, char in enumerate(text) if char == "\n"]
    found: dict[JsonPath, int] = {}

    def line(index: int) -> int:
        return bisect.bisect_right(breaks, index - 1) + 1

    def skip(index: int) -> int:
        match = WHITESPACE.match(text, index)
        return match.end() if match else index

    def value(index: int, path: JsonPath) -> int:
        index = skip(index)
        found[path] = line(index)
        char = text[index]
        if char == "{":
            index = skip(index + 1)
            if text[index] == "}":
                return index + 1
            while True:
                key, index = DECODER.raw_decode(text, skip(index))
                found[(*path, key)] = line(index)
                index = value(skip(index) + 1, (*path, key))
                index = skip(index)
                if text[index] == ",":
                    index += 1
                    continue
                return index + 1
        if char == "[":
            index = skip(index + 1)
            if text[index] == "]":
                return index + 1
            position = 0
            while True:
                index = skip(value(index, (*path, position)))
                position += 1
                if text[index] == ",":
                    index += 1
                    continue
                return index + 1
        return DECODER.raw_decode(text, index)[1]

    value(0, ())
    return found


def dotted(path: Sequence[str | int]) -> str:
    text = ""
    for part in path:
        text += f"[{part}]" if isinstance(part, int) else (f".{part}" if text else part)
    return text or "the file"


def explained(error: ValidationError) -> tuple[Code, JsonPath, str]:
    path: JsonPath = tuple(error.absolute_path)
    where = dotted(path)
    keyword = str(error.validator)
    bound: Any = error.validator_value
    match keyword:
        case "required":
            missing = re.search(r"'([^']+)' is a required property", error.message)
            name = missing.group(1) if missing else "a field"
            return Code.MISSING_FIELD, path, f"{dotted((*path, name))} is required"
        case "additionalProperties":
            extra = re.findall(r"'([^']+)'", error.message.split("(")[-1])
            name = extra[0] if extra else "?"
            return (
                Code.UNKNOWN_FIELD,
                (*path, name),
                f"{dotted((*path, name))} is not a known field",
            )
        case "const" if path == ("format",):
            return Code.WRONG_FORMAT, path, 'format must be "parfocal-results"'
        case "const" if path == ("version",):
            return Code.WRONG_VERSION, path, "version must be 1"
        case "const" | "enum":
            allowed = ", ".join(
                json.dumps(item) for item in (bound if keyword == "enum" else [bound])
            )
            return Code.NOT_ALLOWED, path, f"{where} must be one of {allowed}"
        case "type":
            return Code.WRONG_TYPE, path, f"{where} must be of type {bound}"
        case "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum":
            return Code.OUT_OF_RANGE, path, f"{where} is out of range ({keyword} {bound})"
        case "minLength" | "maxLength" | "minItems" | "maxItems":
            return Code.BAD_LENGTH, path, f"{where} has the wrong length ({keyword} {bound})"
        case "pattern":
            return Code.BAD_PATTERN, path, f"{where} does not match {bound}"
        case _:
            return Code.WRONG_TYPE, path, f"{where}: {error.message}"


def validate(text: str) -> list[Problem]:
    try:
        document: Any = json.loads(text)
    except json.JSONDecodeError as error:
        return [Problem(error.lineno, "the file", Code.NOT_JSON, f"Not valid JSON: {error.msg}")]
    lines = positions(text)
    problems: list[Problem] = []
    errors = cast(Iterable[ValidationError], VALIDATOR.iter_errors(document))
    for error in errors:
        code, path, message = explained(error)
        line = lines.get(path) or lines.get(tuple(error.absolute_path)) or 1
        problems.append(Problem(line, dotted(path), code, message))
    return sorted(problems, key=lambda problem: (problem.line, problem.path, problem.code))


def main(arguments: Sequence[str]) -> int:
    if len(arguments) != 1:
        sys.stderr.write("Usage: python -m parfocal_common.results_schema FILE\n")
        return 2
    problems = validate(Path(arguments[0]).read_text(encoding="utf-8"))
    for problem in problems:
        sys.stdout.write(f"line {problem.line}: {problem.message} [{problem.code}]\n")
    if not problems:
        sys.stdout.write("The file is a valid Parfocal results file.\n")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
