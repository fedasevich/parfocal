import pytest

from parfocal_common.object_store import StoredPart
from parfocal_common.part_plan import (
    DEFAULT_PART_BYTES,
    MAX_PART_BYTES,
    MAX_PARTS,
    MIB,
    PartPlan,
    part_size_for,
    parts_problem,
    plan_parts,
)

GIB = 1024 * MIB


@pytest.mark.parametrize(
    ("file_bytes", "part_bytes"),
    [
        (1, DEFAULT_PART_BYTES),
        (7_000_000_000, DEFAULT_PART_BYTES),
        (20 * GIB, DEFAULT_PART_BYTES),
        (MAX_PARTS * DEFAULT_PART_BYTES, DEFAULT_PART_BYTES),
        (MAX_PARTS * DEFAULT_PART_BYTES + 1, 17 * MIB),
        (200 * GIB, 21 * MIB),
        (MAX_PARTS * MAX_PART_BYTES, MAX_PART_BYTES),
    ],
)
def test_the_part_size_is_16_mib_grown_to_stay_within_10000_parts(
    file_bytes: int, part_bytes: int
) -> None:
    chosen = part_size_for(file_bytes)
    assert chosen == part_bytes
    assert chosen % MIB == 0
    assert plan_parts(file_bytes, chosen).part_count <= MAX_PARTS


def test_a_7_gb_slide_is_418_parts() -> None:
    assert plan_parts(7_000_000_000, part_size_for(7_000_000_000)) == PartPlan(
        DEFAULT_PART_BYTES, 418, 7_000_000_000 - 417 * DEFAULT_PART_BYTES
    )


def test_impossible_sizes_are_refused() -> None:
    with pytest.raises(ValueError, match="at least one byte"):
        part_size_for(0)
    with pytest.raises(ValueError, match="10,000 parts"):
        part_size_for(MAX_PARTS * MAX_PART_BYTES + 1)
    with pytest.raises(ValueError, match="whole MiB"):
        part_size_for(10, 5 * MIB + 1)
    with pytest.raises(ValueError, match="whole MiB"):
        part_size_for(10, 4 * MIB)


def parts(*sizes: int) -> list[StoredPart]:
    return [StoredPart(number, size, f"etag-{number}") for number, size in enumerate(sizes, 1)]


FIVE = 5 * MIB


@pytest.mark.parametrize(
    ("stored", "problem"),
    [
        (parts(FIVE, FIVE, 3), None),
        (list(reversed(parts(FIVE, FIVE, 3))), None),
        (parts(FIVE, FIVE), "Part 3 is missing"),
        ([parts(FIVE, FIVE, 3)[0], parts(FIVE, FIVE, 3)[2]], "Part 2 is missing"),
        (parts(FIVE - 1, FIVE + 1, 3), f"Part 1 has {FIVE - 1} bytes, expected {FIVE}"),
        (parts(FIVE, FIVE, 4), "Part 3 has 4 bytes, expected 3"),
        (parts(FIVE, FIVE, 3, 1), "Part 4 is past the last part 3"),
        ([], "Part 1 is missing"),
    ],
)
def test_parts_must_run_from_1_with_the_stored_size(
    stored: list[StoredPart], problem: str | None
) -> None:
    assert parts_problem(stored, 2 * FIVE + 3, FIVE) == problem


def test_a_one_part_file_has_only_a_last_part() -> None:
    assert parts_problem(parts(10), 10, DEFAULT_PART_BYTES) is None
