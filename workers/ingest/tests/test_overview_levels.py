import io
import math
from pathlib import Path

import numpy as np
import pytest
import tifffile
from fixture_support import fixture_path

from parfocal_ingest.identify import Identified
from parfocal_ingest.overview_levels import (
    OVERVIEW_LEVELS_NAME,
    box_average,
    missing_downsamples,
    overview_levels,
    viewer_tile,
)
from parfocal_ingest.pyramid import Pyramid, read_pyramid
from parfocal_ingest.thumbnail import level_image
from parfocal_ingest.workflow import identify_file

GAPPED = {
    "CMU-1.svs": (256, (32, 64, 128, 256)),
    "JP2K-33003-1.svs": (256, (16, 32, 64, 128)),
    "CMU-1-JP2K-33005.svs": (240, (32, 64, 128, 256)),
    "CMU-1-Small-Region.svs": (240, (2, 4, 8, 16)),
}
COMPLETE = ("CMU-1.tiff", "synthetic-jpeg.tiff")
MULTICHANNEL = ("synthetic-channels-uint8.ome.tiff",)


def opened(name: str) -> tuple[Path, Identified, Pyramid]:
    path = fixture_path(name)
    identified = identify_file(path, name)
    found = read_pyramid(path, identified)
    assert isinstance(found, Pyramid), found
    return path, identified, found


def test_the_box_average_rounds_half_up_and_averages_short_edges_over_what_is_there() -> None:
    pixels = np.array([[[0], [1], [10]], [[1], [1], [20]], [[100], [101], [255]]], dtype=np.uint8)
    pixels = np.repeat(pixels, 3, axis=2)
    averaged = box_average(pixels, 2)
    assert averaged.shape == (2, 2, 3)
    assert averaged[:, :, 0].tolist() == [[1, 15], [101, 255]]


def test_a_level_too_large_to_hold_gets_no_overview_levels() -> None:
    path, identified, found = opened("CMU-1.svs")
    assert identified.format is not None
    finest_only = Pyramid(found.reader, found.levels[:1], found.scale, found.planes, ())
    assert missing_downsamples(finest_only, 256)
    assert overview_levels(path, identified.format, finest_only) is None


@pytest.mark.parametrize("name", COMPLETE + MULTICHANNEL)
def test_a_complete_ladder_or_a_multichannel_slide_gets_none(name: str) -> None:
    path, identified, found = opened(name)
    assert identified.format is not None
    assert overview_levels(path, identified.format, found) is None


@pytest.mark.parametrize("name", sorted(GAPPED))
def test_the_sidecar_holds_each_missing_level_averaged_from_the_coarsest_stored_one(
    name: str,
) -> None:
    path, identified, found = opened(name)
    assert identified.format is not None
    tile, downsamples = GAPPED[name]
    assert viewer_tile(found.levels[0]) == tile
    built = overview_levels(path, identified.format, found)
    assert built is not None
    assert (built.tile, built.downsamples) == (tile, downsamples)
    assert built.reference() == {"path": OVERVIEW_LEVELS_NAME, "downsamples": list(downsamples)}
    base, coarsest = found.levels[0], found.levels[-1]
    source = np.asarray(level_image(path, identified.format, found, coarsest).convert("RGB"))
    with tifffile.TiffFile(io.BytesIO(built.data)) as tiff:
        assert len(tiff.pages) == len(downsamples)
        for page, downsample in zip(tiff.pages, downsamples, strict=True):
            assert isinstance(page, tifffile.TiffPage)
            assert (page.tilewidth, page.tilelength) == (tile, tile)
            assert page.compression == tifffile.COMPRESSION.ADOBE_DEFLATE
            pixels = page.asarray()
            size = (math.ceil(base.height / downsample), math.ceil(base.width / downsample))
            assert pixels.shape == (*size, 3)
            assert np.array_equal(pixels, box_average(source, downsample // coarsest.downsample))
