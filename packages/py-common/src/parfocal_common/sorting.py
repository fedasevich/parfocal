import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

from parfocal_common.object_ids import LOOSE_CASE
from parfocal_common.pairing import clean_path, suffix_of

CASE_LABEL_LENGTH = 100
CASE_NUMBER = re.compile(r"^[A-Za-z]{1,8}\d{0,4}-\d{2,12}$")
NAME_TOKENS = re.compile(r"[_ ]+")


class CaseRule(StrEnum):
    FOLDER = "folder"
    FILE_NAME = "file-name"
    PICKED = "picked"


class CasesFrom(StrEnum):
    NAMES = "names"
    LOOSE = "loose"


@dataclass(frozen=True)
class CaseGuess:
    label: str
    rule: CaseRule


def usable(label: str) -> str | None:
    cleaned = label.strip()
    if not cleaned or cleaned == LOOSE_CASE or len(cleaned) > CASE_LABEL_LENGTH:
        return None
    return cleaned


def folders_of(path: str) -> tuple[str, ...]:
    return clean_path(path).parent.parts


def drop_root(paths: Sequence[str]) -> tuple[str, ...]:
    if not paths:
        return ()
    shared = list(folders_of(paths[0]))
    for path in paths[1:]:
        folders = folders_of(path)
        length = 0
        while length < min(len(shared), len(folders)) and shared[length] == folders[length]:
            length += 1
        del shared[length:]
    return tuple(shared)


def looks_like_case_number(name: str) -> bool:
    return CASE_NUMBER.match(name.strip()) is not None


def name_case(path: str) -> str | None:
    base = clean_path(path).name
    suffix = suffix_of(base)
    stem = base[: len(base) - len(suffix)] if suffix else base
    first = NAME_TOKENS.split(stem.strip(), maxsplit=1)[0]
    return first if looks_like_case_number(first) else None


def case_of(path: str, root: Sequence[str]) -> CaseGuess | None:
    folders = folders_of(path)
    below = folders[len(root) :] if folders[: len(root)] == tuple(root) else folders
    if below:
        label = usable(below[-1])
        if label is not None:
            return CaseGuess(label, CaseRule.FOLDER)
    numbered = next((name for name in reversed(folders) if looks_like_case_number(name)), None)
    if numbered is not None:
        return CaseGuess(numbered.strip(), CaseRule.FOLDER)
    from_name = name_case(path)
    if from_name is not None:
        return CaseGuess(from_name, CaseRule.FILE_NAME)
    return None


def sort_slides(
    slides: Sequence[str],
    dropped: Sequence[str] = (),
    cases_from: CasesFrom = CasesFrom.NAMES,
) -> dict[str, CaseGuess | None]:
    if cases_from is CasesFrom.LOOSE:
        return dict.fromkeys(slides)
    root = drop_root([*slides, *dropped])
    return {path: case_of(path, root) for path in slides}
