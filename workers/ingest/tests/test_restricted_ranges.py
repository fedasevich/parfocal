import json
from pathlib import Path

import pytest
import tifffile
from fixture_support import fixture_path
from test_associated import PRESENT

from parfocal_ingest.pyramid import main_series
from parfocal_ingest.restricted_ranges import (
    ByteRange,
    data_ranges,
    merged,
    ranges_document,
    restricted_ranges,
)

ARCHIVES = {name for name in PRESENT if name.endswith(".zip")}
MOST_RANGES = 8


def covered(span: ByteRange, ranges: list[ByteRange]) -> bool:
    return any(start <= span[0] and span[1] <= end for start, end in ranges)


def overlaps(span: ByteRange, ranges: list[ByteRange]) -> bool:
    return any(span[0] < end and start < span[1] for start, end in ranges)


@pytest.mark.parametrize("name", sorted(set(PRESENT) - ARCHIVES))
def test_label_and_macro_pages_are_closed_and_the_pyramid_stays_open(name: str) -> None:
    path = fixture_path(name)
    ranges = restricted_ranges(path)
    assert len(ranges) <= MOST_RANGES
    with tifffile.TiffFile(path) as tiff:
        pyramid = main_series(tiff)
        assert pyramid is not None
        assert not any(overlaps(span, ranges) for span in data_ranges(pyramid))
        for width, height in PRESENT[name].values():
            (image,) = [series for series in tiff.series if series.shape[:2] == (height, width)]
            assert all(covered(span, ranges) for span in data_ranges(image))
    if not PRESENT[name]:
        assert ranges == []


@pytest.mark.parametrize("name", sorted(ARCHIVES))
def test_an_archive_is_closed_whole(name: str) -> None:
    path = fixture_path(name)
    assert restricted_ranges(path) == [(0, path.stat().st_size)]


def test_a_file_that_is_not_a_tiff_is_closed_whole(tmp_path: Path) -> None:
    path = tmp_path / "original"
    path.write_bytes(b"DICM" * 100)
    assert restricted_ranges(path) == [(0, 400)]


def test_touching_ranges_merge_and_gaps_stay() -> None:
    assert merged([(30, 40), (0, 10), (10, 20), (35, 50)]) == [(0, 20), (30, 50)]


def test_the_document_lists_the_ranges() -> None:
    assert json.loads(ranges_document([(1, 2)])) == {"ranges": [[1, 2]]}
