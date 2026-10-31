import uuid
from collections.abc import Sequence

from storage_support import with_store

from parfocal_common.chunk_store import Cell, build_cells
from parfocal_common.result_store import ObjectResultStore

type CellRow = tuple[int, int, int, float, float]

STAND_IN = uuid.UUID(int=0)


def ring(x: float, y: float) -> list[float]:
    return [x - 1, y - 1, x + 1, y - 1, x + 1, y + 1, x - 1, y + 1]


def cells_of(rows: Sequence[CellRow], probs: Sequence[int] | None, classes: int) -> list[Cell]:
    return [
        Cell(
            number,
            ring(x, y),
            class_index,
            score,
            probs=None if probs is None else probs[index * classes : (index + 1) * classes],
        )
        for index, (number, class_index, score, x, y) in enumerate(rows)
    ]


def chunk_bytes(rows: Sequence[CellRow], probs: Sequence[int] | None, classes: int = 2) -> bytes:
    built = build_cells(STAND_IN, STAND_IN, STAND_IN, cells_of(rows, probs, classes), classes)
    (only,) = built.chunks
    return only.data


def put_chunk(key: str, data: bytes) -> None:
    with_store(lambda store: ObjectResultStore(store).put(key, data))


def delete_chunk(key: str) -> None:
    with_store(lambda store: store.delete_object(key))
