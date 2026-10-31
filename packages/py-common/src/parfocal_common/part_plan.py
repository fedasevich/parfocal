from collections.abc import Sequence
from dataclasses import dataclass

from parfocal_common.object_store import StoredPart

MIB = 1024 * 1024
MIN_PART_BYTES = 5 * MIB
MAX_PART_BYTES = 5 * 1024 * MIB
MAX_PARTS = 10_000
DEFAULT_PART_BYTES = 16 * MIB


@dataclass(frozen=True)
class PartPlan:
    part_bytes: int
    part_count: int
    last_part_bytes: int


def part_size_for(file_bytes: int, preferred_bytes: int = DEFAULT_PART_BYTES) -> int:
    if file_bytes <= 0:
        raise ValueError("A file has at least one byte")
    if preferred_bytes < MIN_PART_BYTES or preferred_bytes % MIB:
        raise ValueError("A part is a whole MiB of at least 5 MiB")
    fewest_bytes = -(-file_bytes // (MAX_PARTS * MIB)) * MIB
    part_bytes = max(preferred_bytes, fewest_bytes)
    if part_bytes > MAX_PART_BYTES:
        raise ValueError("The file does not fit in 10,000 parts")
    return part_bytes


def plan_parts(file_bytes: int, part_bytes: int) -> PartPlan:
    part_count = -(-file_bytes // part_bytes)
    if part_count > MAX_PARTS:
        raise ValueError("The file needs more than 10,000 parts")
    return PartPlan(part_bytes, part_count, file_bytes - (part_count - 1) * part_bytes)


def parts_problem(parts: Sequence[StoredPart], file_bytes: int, part_bytes: int) -> str | None:
    plan = plan_parts(file_bytes, part_bytes)
    ordered = sorted(parts, key=lambda part: part.part_number)
    for index, part in enumerate(ordered, start=1):
        if part.part_number != index:
            return f"Part {index} is missing"
        if index > plan.part_count:
            return f"Part {index} is past the last part {plan.part_count}"
        expected = plan.last_part_bytes if index == plan.part_count else plan.part_bytes
        if part.size != expected:
            return f"Part {index} has {part.size} bytes, expected {expected}"
    if len(ordered) < plan.part_count:
        return f"Part {len(ordered) + 1} is missing"
    return None
