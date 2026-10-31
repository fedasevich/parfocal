import gzip
from array import array
from collections.abc import Sequence

from parfocal_common.cell_chunks import encode, field

type Cell = tuple[int, int, int, float, float]


def chunk_bytes(cells: Sequence[Cell], probs: Sequence[int] | None, classes: int = 2) -> bytes:
    ring: list[float] = []
    for _, _, _, x, y in cells:
        ring += [x - 1, y - 1, x + 1, y - 1, x + 1, y + 1, x - 1, y + 1]
    fields = [
        field("number", "u4", array("I", [cell[0] for cell in cells])),
        field("offsets", "u4", array("I", range(0, 4 * len(cells) + 1, 4))),
        field("points", "f4", array("f", ring)),
        field("class", "u1", array("B", [cell[1] for cell in cells])),
        field("score", "u1", array("B", [cell[2] for cell in cells])),
        field("flags", "u1", array("B", [0] * len(cells))),
        field("region", "u4", array("I", [0] * len(cells))),
    ]
    if probs is not None:
        fields.append(field("probs", "u1", array("B", probs)))
    header = {"version": 1, "kind": "cells", "count": len(cells), "classes": classes}
    return gzip.compress(encode(header, fields))
