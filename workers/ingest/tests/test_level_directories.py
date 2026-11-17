import json
from pathlib import Path

import numpy as np
import pytest
import tifffile
from fixture_support import fixture_path

from parfocal_ingest.identify import Format, Identified
from parfocal_ingest.level_directories import is_located, located
from parfocal_ingest.parse_jobs import identify_file, level_table
from parfocal_ingest.pyramid import Pyramid, read_pyramid
from parfocal_ingest.tile_index import tile_index

FIXTURES = (
    "synthetic-jpeg.tiff",
    "synthetic-sparse.tiff",
    "synthetic-zlib.ome.tiff",
    "synthetic-big-endian.tiff",
    "synthetic-channels-uint8.ome.tiff",
    "synthetic-mxif-uint16-be.ome.tiff",
)


def directory_sizes_of(tiff: tifffile.TiffFile) -> dict[int, int]:
    layout = tiff.tiff
    sizes: dict[int, int] = {}
    for page in tiff.pages:
        assert isinstance(page, tifffile.TiffPage)
        sizes[page.offset] = layout.tagnosize + len(page.tags) * layout.tagsize + layout.offsetsize
        for offset in page.subifds or ():
            tiff.filehandle.seek(offset)
            sub = tifffile.TiffPage(tiff, index=0)
            sizes[offset] = layout.tagnosize + len(sub.tags) * layout.tagsize + layout.offsetsize
    return sizes


def table_of(path: Path) -> dict:
    identified = identify_file(path, path.name)
    found = read_pyramid(path, identified)
    assert isinstance(found, Pyramid), found
    tiles = tile_index(path, identified, found)
    return json.loads(level_table(found, path, tiles))


@pytest.mark.parametrize("name", FIXTURES)
def test_every_level_names_its_directory_offset_page_and_size(name: str) -> None:
    path = fixture_path(name)
    table = table_of(path)
    assert is_located(table)
    with tifffile.TiffFile(path) as tiff:
        sizes = directory_sizes_of(tiff)
        names = {page.offset: number for number, page in enumerate(tiff.pages)}
    for level in table["levels"]:
        for entry in [level, *level["siblings"]]:
            assert entry["ifdBytes"] == sizes[entry["ifdOffset"]]
            if entry["subIfd"] is None:
                assert names[entry["ifdOffset"]] == entry["page"]
        assert level["stored"]["width"] > 0


def test_a_bigtiff_directory_counts_eight_byte_entries(tmp_path: Path) -> None:
    path = tmp_path / "big.tiff"
    pixels = np.zeros((512, 512, 3), np.uint8)
    with tifffile.TiffWriter(path, bigtiff=True) as writer:
        writer.write(pixels, tile=(256, 256), subifds=1, photometric="rgb")
        writer.write(pixels[::2, ::2], tile=(256, 256), subfiletype=1, photometric="rgb")
    found = read_pyramid(path, Identified(Format.GENERIC_TIFF, None))
    assert isinstance(found, Pyramid), found
    tiles = tile_index(path, Identified(Format.GENERIC_TIFF, None), found)
    table = json.loads(level_table(found, path, tiles))
    with tifffile.TiffFile(path) as tiff:
        sizes = directory_sizes_of(tiff)
    for level in table["levels"]:
        assert level["ifdBytes"] == sizes[level["ifdOffset"]]


def test_a_table_without_a_tile_index_keeps_its_levels_unlocated() -> None:
    path = fixture_path("synthetic-jpeg.tiff")
    found = read_pyramid(path, identify_file(path, path.name))
    assert isinstance(found, Pyramid)
    table = json.loads(level_table(found))
    assert not is_located(table)


def test_a_tile_index_of_another_level_count_leaves_the_table_alone() -> None:
    table = {"levels": [{"width": 1}, {"width": 2}]}
    tiles = {"levels": [{"page": 0, "ifdOffset": 8, "siblings": []}]}
    assert located(table, tiles, {8: 18}) is table
