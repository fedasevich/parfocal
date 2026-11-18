import math
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import cast

from parfocal_common.ingest import SlideFolderError, slide_folder_in

KIND = "outline-types"
TYPER = "pathosam-hovernext"
TYPER_VERSION = "v1.2"
TYPER_WEIGHTS = "hovernext-pannuke"
TYPER_CLASSES = ("tumor", "stroma", "immune", "other")
MAX_OUTLINES = 500
MIN_POINTS = 6
MAX_POINTS = 4096
MAX_OUTLINE_SPAN = 512
SHARE_TOLERANCE = 1e-3

type Points = tuple[float, ...]


class OutlineTypesCallError(ValueError):
    pass


@dataclass(frozen=True)
class OutlineTypesCall:
    tenant_id: uuid.UUID
    slide_id: uuid.UUID
    outlines: tuple[Points, ...]
    temperature: float = 1.0
    folder: str | None = None

    def call(self) -> dict[str, object]:
        call: dict[str, object] = {
            "kind": KIND,
            "tenant_id": str(self.tenant_id),
            "slide_id": str(self.slide_id),
            "outlines": [list(points) for points in self.outlines],
            "temperature": self.temperature,
        }
        if self.folder is not None:
            call["folder"] = self.folder
        return call


def span_of(points: Sequence[float]) -> float:
    xs, ys = points[0::2], points[1::2]
    return max(max(xs) - min(xs), max(ys) - min(ys))


def fits(points: Sequence[float]) -> bool:
    return (
        MIN_POINTS <= len(points) <= MAX_POINTS
        and len(points) % 2 == 0
        and all(math.isfinite(value) for value in points)
        and span_of(points) <= MAX_OUTLINE_SPAN
    )


def number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def share(value: object) -> bool:
    found = number(value)
    return found is not None and 0.0 <= found <= 1.0


def items_of(value: object) -> list[object] | None:
    return cast("list[object]", value) if isinstance(value, list | tuple) else None


def mapping_of(value: object) -> Mapping[str, object] | None:
    return cast("Mapping[str, object]", value) if isinstance(value, Mapping) else None


def points_of(outline: object) -> Points:
    items = items_of(outline)
    values = tuple(number(value) for value in items or ())
    points = tuple(value for value in values if value is not None)
    if items is None or len(points) != len(items) or not fits(points):
        raise OutlineTypesCallError("Each outline is a small closed ring of x and y numbers")
    return points


def outline_types_call_of(call: Mapping[str, object]) -> OutlineTypesCall:
    outlines, temperature = items_of(call.get("outlines")), number(call.get("temperature", 1.0))
    if call.get("kind") != KIND or outlines is None:
        raise OutlineTypesCallError("An outline types call names its kind and outlines")
    if not 1 <= len(outlines) <= MAX_OUTLINES:
        raise OutlineTypesCallError(f"Send one to {MAX_OUTLINES} outlines")
    if temperature is None or temperature <= 0:
        raise OutlineTypesCallError("The temperature is a positive number")
    return OutlineTypesCall(
        uuid.UUID(str(call.get("tenant_id"))),
        uuid.UUID(str(call.get("slide_id"))),
        tuple(points_of(outline) for outline in outlines),
        temperature,
        folder_in(call.get("folder")),
    )


def folder_in(value: object) -> str | None:
    try:
        return slide_folder_in(value)
    except SlideFolderError as error:
        raise OutlineTypesCallError(str(error)) from error


def typed_outline(typed: object) -> bool:
    found = mapping_of(typed)
    if found is None:
        return False
    probabilities = mapping_of(found.get("probabilities"))
    alternatives = items_of(found.get("alternatives"))
    if probabilities is None or alternatives is None or set(probabilities) != set(TYPER_CLASSES):
        return False
    shares = [number(value) for value in probabilities.values()]
    if not all(share(value) for value in shares):
        return False
    if abs(sum(value or 0.0 for value in shares) - 1.0) > SHARE_TOLERANCE:
        return False
    return (
        found.get("type") in TYPER_CLASSES
        and all(name in TYPER_CLASSES for name in alternatives)
        and share(found.get("foreground"))
    )


def typed_outlines_in(reply: Mapping[str, object], count: int) -> list[Mapping[str, object]] | None:
    outlines = items_of(reply.get("outlines"))
    if outlines is None or len(outlines) != count:
        return None
    typed = [mapping_of(outline) for outline in outlines]
    if not all(typed_outline(outline) for outline in outlines):
        return None
    return [outline for outline in typed if outline is not None]
