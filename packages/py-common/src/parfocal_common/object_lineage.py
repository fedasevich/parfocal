from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from parfocal_common.object_ids import Letter, ObjectId

Key = tuple[int, str]


class Retired(StrEnum):
    SPLIT = "split"
    MERGED = "merged"


@dataclass(frozen=True)
class Fate:
    deleted: bool = False
    retired: Retired | None = None
    merged_into: Key | None = None


def parts_of(fates: Mapping[Key, Fate], key: Key) -> list[Key]:
    number, split = key
    return sorted(
        other
        for other in fates
        if other[0] == number and len(other[1]) == len(split) + 1 and other[1].startswith(split)
    )


def descendants(fates: Mapping[Key, Fate], key: Key) -> list[Key]:
    found: list[Key] = []
    for part in parts_of(fates, key):
        found += [part, *descendants(fates, part)]
    return found


def current(fates: Mapping[Key, Fate], key: Key) -> list[Key]:
    fate = fates.get(key)
    if fate is None:
        return [key]
    if fate.retired is Retired.MERGED and fate.merged_into is not None:
        return current(fates, fate.merged_into)
    if fate.retired is Retired.SPLIT:
        leaves = [live for part in parts_of(fates, key) for live in current(fates, part)]
        return list(dict.fromkeys(leaves))
    return [] if fate.deleted else [key]


def resolve(letter: Letter, fates: Mapping[Key, Fate], found: ObjectId) -> list[ObjectId]:
    return [
        ObjectId(letter, number, split)
        for number, split in current(fates, (found.number, found.split))
    ]
