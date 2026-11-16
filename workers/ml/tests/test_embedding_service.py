import json
import uuid

import numpy as np
import pytest
from numpy.typing import NDArray

from parfocal_common.embedding_cache import (
    EMBEDDING_BYTES,
    EMBEDDING_DIMS,
    SERVER_ENCODER,
    manifest_key,
    read_manifest,
    tile_key,
)
from parfocal_ml.embedding_service import (
    EmbeddingLevel,
    EmbeddingShapeError,
    TissueCells,
    build_cache,
    pack_embedding,
    tile_pixels,
    tissue_tiles,
)

TENANT = uuid.UUID(int=1)
SLIDE = uuid.UUID(int=2)
LEVEL = EmbeddingLevel(index=0, downsample=1.0, width=1200, height=1000, microns_per_pixel=0.25)


def tiny_encoder(pixels: NDArray[np.float32]) -> NDArray[np.float32]:
    assert pixels.shape == (1, 3, 1024, 1024)
    planes = np.empty(EMBEDDING_DIMS, dtype=np.float32)
    planes[:] = np.float32(pixels[0, 0, 0, 0])
    planes[0, :, 0, 0] = np.arange(256, dtype=np.float32) / 8
    return planes


def flat_reader(x: int, y: int, width: int, height: int) -> NDArray[np.uint8]:
    return np.full((height, width, 3), (x + y) % 256, dtype=np.uint8)


def tissue_at(cells: list[tuple[int, int]], cell: int = 64) -> TissueCells:
    grid = np.zeros((16, 19), dtype=bool)
    for column, row in cells:
        grid[row, column] = True
    return TissueCells(cell, grid)


def test_a_tile_is_128_microns_at_the_level_resolution() -> None:
    assert tile_pixels(LEVEL) == 512
    assert tile_pixels(EmbeddingLevel(1, 2.0, 600, 500, 0.5)) == 256
    assert tile_pixels(EmbeddingLevel(0, 1.0, 600, 500, None)) == 512


def test_only_tiles_over_tissue_are_encoded() -> None:
    assert tissue_tiles(LEVEL, 512, tissue_at([(0, 0)])) == {(0, 0)}
    assert tissue_tiles(LEVEL, 512, tissue_at([(9, 9)])) == {(1, 1)}
    assert tissue_tiles(LEVEL, 512, tissue_at([(18, 0)])) == {(2, 0)}
    assert tissue_tiles(LEVEL, 512, tissue_at([])) == set()


def test_the_embedding_is_packed_as_little_endian_float16() -> None:
    body = pack_embedding(tiny_encoder(np.zeros((1, 3, 1024, 1024), dtype=np.float32)))
    assert len(body) == EMBEDDING_BYTES
    values = np.frombuffer(body, dtype="<f2")
    assert values[: 4 * 64 * 64 : 64 * 64].tolist() == [0.0, 0.125, 0.25, 0.375]


def test_a_wrong_shape_is_refused() -> None:
    with pytest.raises(EmbeddingShapeError):
        pack_embedding(np.zeros((1, 256, 32, 32), dtype=np.float32))


def test_the_cache_writes_each_tissue_tile_then_the_manifest() -> None:
    written: list[tuple[str, int, str]] = []
    stored: dict[str, bytes] = {}

    def write(key: str, body: bytes, content_type: str) -> None:
        written.append((key, len(body), content_type))
        stored[key] = body

    manifest = build_cache(
        TENANT, SLIDE, LEVEL, tissue_at([(0, 0), (9, 9)]), flat_reader, tiny_encoder, write
    )
    assert [key for key, _, _ in written] == [
        tile_key(TENANT, SLIDE, 0, 0),
        tile_key(TENANT, SLIDE, 1, 1),
        manifest_key(TENANT, SLIDE),
    ]
    assert all(size == EMBEDDING_BYTES for _, size, _ in written[:2])
    read = read_manifest(stored[manifest_key(TENANT, SLIDE)])
    assert read == manifest
    assert (read.encoder, read.tile, read.columns, read.rows) == (SERVER_ENCODER, 512, 3, 2)
    assert [read.has(0, 0), read.has(1, 1), read.has(1, 0), read.has(3, 0)] == [
        True,
        True,
        False,
        False,
    ]
    assert json.loads(stored[manifest_key(TENANT, SLIDE)])["dtype"] == "float16-le"
