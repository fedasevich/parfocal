import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from parfocal_common.embedding_cache import (
    EMBEDDING_BYTES,
    EMBEDDING_CONTENT_TYPE,
    EMBEDDING_DIMS,
    SERVER_ENCODER,
    TILE_MICRONS,
    EmbeddingManifest,
    bitset,
    grid_size,
    manifest_key,
    tile_key,
    tile_origin,
)
from parfocal_ml.sam_contract import pixel_values

MANIFEST_CONTENT_TYPE = "application/json"


class Encoder(Protocol):
    def __call__(self, pixels: NDArray[np.float32]) -> NDArray[np.float32]: ...


class TileReader(Protocol):
    def __call__(self, x: int, y: int, width: int, height: int) -> NDArray[np.uint8]: ...


type Writer = Callable[[str, bytes, str], None]


@dataclass(frozen=True)
class EmbeddingLevel:
    index: int
    downsample: float
    width: int
    height: int
    microns_per_pixel: float | None


@dataclass(frozen=True)
class TissueCells:
    cell: int
    cells: NDArray[np.bool_]


class EmbeddingShapeError(ValueError):
    pass


def tile_pixels(level: EmbeddingLevel) -> int:
    if level.microns_per_pixel is None or level.microns_per_pixel <= 0:
        return 512
    return max(1, round(TILE_MICRONS / level.microns_per_pixel))


def pack_embedding(embedding: NDArray[np.float32]) -> bytes:
    if tuple(embedding.shape) != EMBEDDING_DIMS:
        raise EmbeddingShapeError(f"the encoder gave {embedding.shape}, not {EMBEDDING_DIMS}")
    body = np.ascontiguousarray(embedding, dtype="<f2").tobytes()
    assert len(body) == EMBEDDING_BYTES
    return body


def tissue_tiles(level: EmbeddingLevel, tile: int, tissue: TissueCells) -> set[tuple[int, int]]:
    columns, rows = grid_size(level.width, tile), grid_size(level.height, tile)
    span = tile * level.downsample

    def cells_under(origin: int) -> slice:
        start = origin * level.downsample
        return slice(int(start // tissue.cell), int(-(-(start + span) // tissue.cell)))

    return {
        (column, row)
        for row in range(rows)
        for column in range(columns)
        if tissue.cells[
            cells_under(tile_origin(row, tile, level.height)),
            cells_under(tile_origin(column, tile, level.width)),
        ].any()
    }


def tile_windows(
    level: EmbeddingLevel, tile: int, cells: set[tuple[int, int]]
) -> Iterator[tuple[int, int, int, int]]:
    for column, row in sorted(cells, key=lambda cell: (cell[1], cell[0])):
        yield (
            column,
            row,
            tile_origin(column, tile, level.width),
            tile_origin(row, tile, level.height),
        )


def build_cache(
    tenant_id: uuid.UUID,
    slide_id: uuid.UUID,
    level: EmbeddingLevel,
    tissue: TissueCells,
    read: TileReader,
    encode: Encoder,
    write: Writer,
) -> EmbeddingManifest:
    tile = min(tile_pixels(level), level.width, level.height)
    cells = tissue_tiles(level, tile, tissue)
    for column, row, x, y in tile_windows(level, tile, cells):
        rgb = read(x, y, tile, tile)
        body = pack_embedding(encode(pixel_values(rgb)))
        write(tile_key(tenant_id, slide_id, column, row), body, EMBEDDING_CONTENT_TYPE)
    columns, rows = grid_size(level.width, tile), grid_size(level.height, tile)
    manifest = EmbeddingManifest(
        encoder=SERVER_ENCODER,
        level=level.index,
        downsample=level.downsample,
        tile=tile,
        level_width=level.width,
        level_height=level.height,
        columns=columns,
        rows=rows,
        tiles=bitset(columns, rows, cells),
    )
    write(manifest_key(tenant_id, slide_id), manifest.render(), MANIFEST_CONTENT_TYPE)
    return manifest
