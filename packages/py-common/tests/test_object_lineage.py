from parfocal_common.object_ids import Letter, parse
from parfocal_common.object_lineage import Fate, Key, Retired, descendants, resolve

SPLIT = Fate(retired=Retired.SPLIT)
LIVE = Fate()


def names(fates: dict[Key, Fate], text: str) -> list[str]:
    return [str(item) for item in resolve(Letter.REGION, fates, parse(text))]


def merged_into(number: int, split: str = "") -> Fate:
    return Fate(retired=Retired.MERGED, merged_into=(number, split))


def test_an_untouched_object_resolves_to_itself() -> None:
    assert names({}, "T2") == ["T2"]


def test_a_split_object_stays_in_the_history_and_resolves_to_its_parts() -> None:
    fates = {(2, ""): SPLIT, (2, "a"): LIVE, (2, "b"): LIVE}
    assert names(fates, "T2") == ["T2a", "T2b"]
    assert names(fates, "T2b") == ["T2b"]


def test_a_part_split_again_resolves_to_the_leaves() -> None:
    fates = {(2, ""): SPLIT, (2, "a"): SPLIT, (2, "b"): LIVE, (2, "aa"): LIVE, (2, "ab"): LIVE}
    assert names(fates, "T2") == ["T2aa", "T2ab", "T2b"]
    assert descendants(fates, (2, "")) == [(2, "a"), (2, "aa"), (2, "ab"), (2, "b")]


def test_a_merged_alias_still_resolves_to_the_kept_object() -> None:
    fates = {(2, ""): LIVE, (3, ""): merged_into(2)}
    assert names(fates, "T3") == ["T2"]


def test_an_alias_follows_the_kept_object_through_a_later_split() -> None:
    fates = {(2, ""): SPLIT, (2, "a"): LIVE, (2, "b"): LIVE, (3, ""): merged_into(2)}
    assert names(fates, "T3") == ["T2a", "T2b"]


def test_an_alias_of_a_part_resolves_to_that_part() -> None:
    fates = {(2, ""): SPLIT, (2, "a"): LIVE, (2, "b"): merged_into(2, "a")}
    assert names(fates, "T2b") == ["T2a"]
    assert names(fates, "T2") == ["T2a"]


def test_a_deleted_object_resolves_to_nothing() -> None:
    assert names({(4, ""): Fate(deleted=True)}, "T4") == []
