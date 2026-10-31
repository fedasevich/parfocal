import csv
import io
import json
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import PurePosixPath

HEAD_BYTES = 64 * 1024
SEPARATORS = frozenset("._- ")
DOUBLE_SUFFIXES = (".ome.tiff", ".ome.tif", ".ome.zarr")
SLIDE_SUFFIXES = frozenset(
    {
        ".svs",
        ".tif",
        ".tiff",
        ".ndpi",
        ".scn",
        ".bif",
        ".avs",
        ".dcm",
        ".mrxs",
        ".vsi",
        ".czi",
        ".zvi",
        ".isyntax",
        ".zip",
    }
)
RESULT_SUFFIXES = frozenset({".geojson", ".json", ".csv", ".tsv", ".png"})
SLIDE_COLUMNS = ("slide_id", "slide", "slide_name", "image", "image_id", "file_name")
SLIDE_BLOCK = re.compile(r'"slide"\s*:\s*(\{[^{}]*\})')
TEXT_FIELD = r'"{name}"\s*:\s*"((?:[^"\\]|\\.){{1,255}})"'


class FileKind(StrEnum):
    SLIDE = "slide"
    RESULT = "result"
    OTHER = "other"


class Rule(StrEnum):
    NEXT_TO_SLIDE = "next-to-slide"
    FOLDER_NAMED_LIKE_SLIDE = "folder-named-like-slide"
    FILE_NAME = "file-name"
    EMBEDDED_ID = "embedded-id"
    PICKED = "picked"


class Certainty(StrEnum):
    SURE = "sure"
    LIKELY = "likely"


class Outcome(StrEnum):
    PAIRED = "paired"
    TIE = "tie"
    UNMATCHED = "unmatched"


class PairBy(StrEnum):
    AUTO = "auto"
    NAME = "name"
    EMBEDDED = "embedded"


@dataclass(frozen=True)
class Hint:
    slide_id: str | None = None
    file_name: str | None = None


@dataclass(frozen=True)
class SlideCandidate:
    key: str
    name: str
    path: str | None = None
    slide_id: str | None = None


@dataclass(frozen=True)
class ResultFile:
    path: str
    hint: Hint | None = None


@dataclass(frozen=True)
class Pairing:
    path: str
    outcome: Outcome
    slide: str | None = None
    rule: Rule | None = None
    certainty: Certainty | None = None
    candidates: tuple[str, ...] = ()


@dataclass(frozen=True)
class Match:
    candidate: SlideCandidate
    certainty: Certainty
    strength: int


@dataclass(frozen=True)
class Verdict:
    rule: Rule
    certainty: Certainty
    candidates: tuple[str, ...]


def clean_path(path: str) -> PurePosixPath:
    return PurePosixPath(path.replace("\\", "/").strip("/"))


def suffix_of(name: str) -> str:
    lowered = name.lower()
    double = next((suffix for suffix in DOUBLE_SUFFIXES if lowered.endswith(suffix)), None)
    return double or PurePosixPath(lowered).suffix


def stem_of(name: str) -> str:
    base = clean_path(name).name
    suffix = suffix_of(base)
    stem = base[: len(base) - len(suffix)] if suffix else base
    return stem.strip().casefold()


def kind_of(path: str) -> FileKind:
    suffix = suffix_of(clean_path(path).name)
    if suffix in SLIDE_SUFFIXES or suffix in DOUBLE_SUFFIXES:
        return FileKind.SLIDE
    if suffix in RESULT_SUFFIXES:
        return FileKind.RESULT
    return FileKind.OTHER


def name_match(result_stem: str, slide_stem: str) -> Certainty | None:
    if not result_stem or not slide_stem:
        return None
    if result_stem == slide_stem:
        return Certainty.SURE
    if result_stem.startswith(slide_stem) and result_stem[len(slide_stem)] in SEPARATORS:
        return Certainty.LIKELY
    return None


def next_to_slide(result: ResultFile, slides: Sequence[SlideCandidate]) -> list[Match]:
    folder = clean_path(result.path).parent
    found: list[Match] = []
    for slide in slides:
        if slide.path is None or clean_path(slide.path).parent != folder:
            continue
        slide_stem = stem_of(slide.path)
        if name_match(stem_of(result.path), slide_stem) is not None:
            found.append(Match(slide, Certainty.SURE, len(slide_stem)))
    return found


def folder_named_like_slide(result: ResultFile, slides: Sequence[SlideCandidate]) -> list[Match]:
    folder = clean_path(result.path).parent
    if folder == PurePosixPath("."):
        return []
    folder_name = folder.name.strip().casefold()
    found: list[Match] = []
    for slide in slides:
        if slide.path is None:
            continue
        place = clean_path(slide.path).parent
        if stem_of(slide.path) == folder_name and place in {folder, folder.parent}:
            found.append(Match(slide, Certainty.SURE, len(folder_name)))
    return found


def file_name(result: ResultFile, slides: Sequence[SlideCandidate]) -> list[Match]:
    result_stem = stem_of(result.path)
    found: list[Match] = []
    for slide in slides:
        slide_stem = stem_of(slide.path) if slide.path is not None else slide.name.casefold()
        certainty = name_match(result_stem, slide_stem.strip())
        if certainty is not None:
            found.append(Match(slide, certainty, len(slide_stem)))
    return found


def embedded_id(result: ResultFile, slides: Sequence[SlideCandidate]) -> list[Match]:
    hint = result.hint
    if hint is None:
        return []
    found: list[Match] = []
    named = [value for value in (hint.slide_id, hint.file_name) if value]
    for slide in slides:
        slide_stem = stem_of(slide.path) if slide.path is not None else slide.name.casefold()
        if (
            hint.slide_id
            and slide.slide_id
            and hint.slide_id.strip().casefold() == (slide.slide_id.casefold())
        ):
            found.append(Match(slide, Certainty.SURE, len(slide_stem)))
        elif any(stem_of(value) == slide_stem.strip() for value in named):
            found.append(Match(slide, Certainty.LIKELY, len(slide_stem)))
    return found


type RuleBody = Callable[[ResultFile, Sequence[SlideCandidate]], list[Match]]

RULES: dict[Rule, RuleBody] = {
    Rule.NEXT_TO_SLIDE: next_to_slide,
    Rule.FOLDER_NAMED_LIKE_SLIDE: folder_named_like_slide,
    Rule.FILE_NAME: file_name,
    Rule.EMBEDDED_ID: embedded_id,
}
ORDER: dict[PairBy, tuple[Rule, ...]] = {
    PairBy.AUTO: (
        Rule.NEXT_TO_SLIDE,
        Rule.FOLDER_NAMED_LIKE_SLIDE,
        Rule.FILE_NAME,
        Rule.EMBEDDED_ID,
    ),
    PairBy.NAME: (Rule.FILE_NAME,),
    PairBy.EMBEDDED: (Rule.EMBEDDED_ID,),
}


def best_of(rule: Rule, matches: Sequence[Match]) -> Verdict | None:
    if not matches:
        return None
    certainty = (
        Certainty.SURE
        if any(m.certainty is Certainty.SURE for m in matches)
        else (Certainty.LIKELY)
    )
    kept = [match for match in matches if match.certainty is certainty]
    strongest = max(match.strength for match in kept)
    keys = tuple(dict.fromkeys(m.candidate.key for m in kept if m.strength == strongest))
    return Verdict(rule, certainty, keys)


def pairing_of(verdict: Verdict, path: str) -> Pairing:
    if len(verdict.candidates) == 1:
        return Pairing(path, Outcome.PAIRED, verdict.candidates[0], verdict.rule, verdict.certainty)
    return Pairing(path, Outcome.TIE, None, verdict.rule, verdict.certainty, verdict.candidates)


def pair_one(
    result: ResultFile, slides: Sequence[SlideCandidate], by: PairBy = PairBy.AUTO
) -> Pairing:
    fallback: Verdict | None = None
    for rule in ORDER[by]:
        verdict = best_of(rule, RULES[rule](result, slides))
        if verdict is None:
            continue
        if verdict.certainty is Certainty.SURE:
            return pairing_of(verdict, result.path)
        fallback = fallback or verdict
    if fallback is not None:
        return pairing_of(fallback, result.path)
    return Pairing(result.path, Outcome.UNMATCHED)


def pair_results(
    results: Sequence[ResultFile], slides: Sequence[SlideCandidate], by: PairBy = PairBy.AUTO
) -> list[Pairing]:
    return [pair_one(result, slides, by) for result in results]


def unescaped(value: str) -> str:
    try:
        decoded = json.loads(f'"{value}"')
    except ValueError:
        return value
    return decoded if isinstance(decoded, str) else value


def text_field(block: str, name: str) -> str | None:
    found = re.search(TEXT_FIELD.format(name=name), block)
    return unescaped(found.group(1)).strip() or None if found else None


def json_hint(head: str) -> Hint | None:
    block = SLIDE_BLOCK.search(head)
    if block is None:
        return None
    hint = Hint(text_field(block.group(1), "slide_id"), text_field(block.group(1), "file_name"))
    return hint if hint.slide_id or hint.file_name else None


def delimiter_of(line: str) -> str:
    if "\t" in line:
        return "\t"
    return ";" if line.count(";") > line.count(",") else ","


def table_hint(head: str) -> Hint | None:
    lines = head.splitlines()
    if len(lines) < 2:
        return None
    delimiter = delimiter_of(lines[0])
    rows = list(csv.reader(io.StringIO("\n".join(lines[:2])), delimiter=delimiter))
    if len(rows) < 2:
        return None
    header = [column.strip().casefold() for column in rows[0]]
    for name in SLIDE_COLUMNS:
        if name in header:
            index = header.index(name)
            value = rows[1][index].strip() if index < len(rows[1]) else ""
            if value:
                return Hint(slide_id=value[:255])
    return None


def embedded_hint(head: str, name: str) -> Hint | None:
    text = head[:HEAD_BYTES].lstrip("﻿")
    suffix = suffix_of(clean_path(name).name)
    if suffix in {".csv", ".tsv"}:
        return table_hint(text)
    if suffix in {".json", ".geojson"} or text.lstrip().startswith("{"):
        return json_hint(text)
    return None
