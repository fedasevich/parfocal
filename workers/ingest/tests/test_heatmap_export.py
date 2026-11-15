import gzip
from pathlib import Path

import numpy as np
import tifffile

from parfocal_ingest.heatmap_export import (
    export_heatmap_pyramid,
    grid_values,
    read_exported_levels,
)
from parfocal_ingest.import_checks import heatmap_values, stored_values


def stored_grid(height: int, width: int) -> tuple[bytes, dict[str, object], np.ndarray]:
    rng = np.random.default_rng(7)
    grid = rng.integers(0, 256, size=(height, width), dtype=np.uint8)
    facts = {"width": width, "height": height, "level": 2, "downsample": 4.0, "mpp": 1.0}
    return gzip.compress(grid.tobytes(), 6, mtime=0), facts, grid


def test_an_exported_heatmap_reimports_with_the_same_values(tmp_path: Path) -> None:
    packed, facts, grid = stored_grid(700, 1100)
    path = tmp_path / "heatmap.tiff"
    path.write_bytes(export_heatmap_pyramid(packed, facts))
    reimported = stored_values(heatmap_values(path, path.name))
    assert reimported.shape == grid.shape
    assert np.array_equal(reimported, grid)
    assert np.array_equal(grid_values(packed, facts), grid)


def test_the_export_is_a_tiled_pyramid_that_halves_each_level(tmp_path: Path) -> None:
    packed, facts, _ = stored_grid(700, 1100)
    data = export_heatmap_pyramid(packed, facts)
    levels = read_exported_levels(data)
    assert [level.shape for level in levels] == [(700, 1100), (350, 550), (175, 275)]
    path = tmp_path / "heatmap.tiff"
    path.write_bytes(data)
    with tifffile.TiffFile(path) as handle:
        first = handle.series[0].pages[0]
        assert isinstance(first, tifffile.TiffPage)
        assert first.is_tiled
        assert first.tilewidth == 256
