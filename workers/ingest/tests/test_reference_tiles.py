import json
import os
from pathlib import Path

import numpy as np
import pytest
import tifffile
from fixture_support import ROOT, fixture_path
from PIL import Image

from parfocal_ingest.identify import Format, identify
from parfocal_ingest.pyramid import Pyramid, main_series, read_pyramid
from parfocal_ingest.reference_tiles import Window, read_window, write_reference

REFERENCE = ROOT / "packages" / "test-fixtures" / "reference-tiles"
FIXTURES = [
    "synthetic-jpeg.tiff",
    "synthetic-zlib.ome.tiff",
    "synthetic-big-endian.tiff",
    "CMU-1-Small-Region.svs",
    "JP2K-33003-1.svs",
    "CMU-1.svs",
    "Philips-4.tiff",
    "Philips-3.tiff",
    "Huron-1-40x.tif",
    "Huron-1-Uncompressed.tif",
    "Argos-1.avs",
    "Argos-1-Stacked.avs",
    "CMU-1.ndpi",
    "Hamamatsu-1.ndpi",
]
TOLERANCE = 1.0


def pixels(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert("RGB"), dtype=np.int16)


def opened(name: str) -> tuple[Path, Pyramid]:
    path = fixture_path(name)
    with path.open("rb") as handle:
        found = identify(handle, path.name)
    pyramid = read_pyramid(path, found)
    assert isinstance(pyramid, Pyramid), pyramid
    return path, pyramid


def stored_level(path: Path, index: int) -> np.ndarray:
    with tifffile.TiffFile(path) as tiff:
        series = main_series(tiff)
        assert series is not None
        return series.levels[index].asarray()


def test_openslide_windows_sit_where_tifffile_puts_them() -> None:
    path, pyramid = opened("synthetic-big-endian.tiff")
    assert pyramid.reader.value == "openslide"
    for level in pyramid.levels[:2]:
        window = Window(level.index, level.downsample, 40, 24, 64, 48)
        read = pixels(read_window(path, Format.GENERIC_TIFF, pyramid, window))
        stored = stored_level(path, level.index)[24:72, 40:104].astype(np.int16)
        assert np.array_equal(read, stored)


def test_a_coarser_window_matches_the_finest_level_averaged() -> None:
    path, pyramid = opened("synthetic-zlib.ome.tiff")
    window = Window(1, 2, 64, 32, 128, 96)
    read = pixels(read_window(path, Format.OME_TIFF, pyramid, window)).astype(np.float64)
    finest = stored_level(path, 0)[64:256, 128:384].astype(np.float64)
    averaged = finest.reshape(96, 2, 128, 2, 3).mean(axis=(1, 3))
    assert float(np.abs(read - averaged).mean()) <= TOLERANCE


@pytest.mark.parametrize("name", FIXTURES)
def test_the_committed_reference_tiles_match_the_server_reader(name: str, tmp_path: Path) -> None:
    path = fixture_path(name)
    target = REFERENCE / name if os.environ.get("PARFOCAL_UPDATE_GOLDEN") == "1" else tmp_path
    windows = write_reference(path, target)
    committed = json.loads((REFERENCE / name / "manifest.json").read_text())
    assert [entry["file"] for entry in committed["windows"]] == [w.file for w in windows]
    assert len({w.level for w in windows}) == len(windows)
    for window in windows:
        made = pixels(Image.open(target / window.file)).astype(np.float64)
        stored = pixels(Image.open(REFERENCE / name / window.file)).astype(np.float64)
        assert made.shape == (window.height, window.width, 3)
        assert float(np.abs(made - stored).mean()) <= TOLERANCE
