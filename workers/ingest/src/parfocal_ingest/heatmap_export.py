import gzip
import io
import json
from collections.abc import Mapping
from typing import Any

import numpy as np
import tifffile
from numpy.typing import NDArray

TILE = 256
MIN_SIDE = TILE
DOWNSAMPLE_STEP = 2


def grid_values(packed: bytes, facts: Mapping[str, Any]) -> NDArray[np.uint8]:
    width = int(facts["width"])
    height = int(facts["height"])
    flat = np.frombuffer(gzip.decompress(packed), dtype=np.uint8)
    return flat.reshape(height, width)


def halve(values: NDArray[np.uint8]) -> NDArray[np.uint8]:
    height, width = values.shape
    padded = np.pad(values, ((0, height % 2), (0, width % 2)), mode="edge").astype(np.uint16)
    summed = padded[0::2, 0::2] + padded[1::2, 0::2] + padded[0::2, 1::2] + padded[1::2, 1::2] + 2
    return (summed // 4).astype(np.uint8)


def pyramid_levels(values: NDArray[np.uint8]) -> list[NDArray[np.uint8]]:
    levels = [values]
    while min(levels[-1].shape) > MIN_SIDE:
        levels.append(halve(levels[-1]))
    return levels


def tile_for(values: NDArray[np.uint8]) -> tuple[int, int]:
    return (TILE, TILE) if min(values.shape) >= TILE else (16, 16)


def export_heatmap_pyramid(packed: bytes, facts: Mapping[str, Any]) -> bytes:
    levels = pyramid_levels(grid_values(packed, facts))
    description = json.dumps(
        {
            key: facts.get(key)
            for key in ("level", "downsample", "mpp", "tissue_share")
            if key in facts
        }
    )
    out = io.BytesIO()
    with tifffile.TiffWriter(out, bigtiff=True) as writer:
        writer.write(
            levels[0],
            tile=tile_for(levels[0]),
            compression="deflate",
            photometric="minisblack",
            subifds=len(levels) - 1,
            description=description,
            metadata=None,
        )
        for level in levels[1:]:
            writer.write(
                level,
                tile=tile_for(level),
                compression="deflate",
                photometric="minisblack",
                subfiletype=1,
                metadata=None,
            )
    return out.getvalue()


def read_exported_levels(data: bytes) -> list[NDArray[Any]]:
    with tifffile.TiffFile(io.BytesIO(data)) as handle:
        series = handle.series[0]
        return [level.asarray() for level in series.levels]
