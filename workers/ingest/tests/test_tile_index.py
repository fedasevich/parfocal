import base64
import io
import json
import os
from pathlib import Path
from typing import Any

import pytest
import tifffile
from fixture_support import fixture_path
from PIL import Image

from parfocal_ingest.identify import Format, Identified
from parfocal_ingest.pyramid import Pyramid, main_series, read_pyramid
from parfocal_ingest.tile_index import (
    bif_stitching,
    frame_cell,
    index_document,
    offset_gaps,
    tile_index,
)
from parfocal_ingest.workflow import identify_file

GOLDEN = Path(__file__).resolve().parent / "golden" / "tile-index"
CONTRACT_FIXTURES = (
    "synthetic-jpeg.tiff",
    "synthetic-sparse.tiff",
    "synthetic-zlib.ome.tiff",
    "synthetic-big-endian.tiff",
    "synthetic-channels-uint8.ome.tiff",
    "synthetic-mxif-uint16-be.ome.tiff",
)
CACHED = ("CMU-1.svs", "tumor_009.tif", "Leica-1.scn", "Huron-1-40x.tif", "CMU-1.ndpi", "OS-1.bif")
JPEG_END = b"\xff\xd9"


def indexed(name: str) -> tuple[Path, dict[str, Any]]:
    path = fixture_path(name)
    identified = identify_file(path, name)
    found = read_pyramid(path, identified)
    assert isinstance(found, Pyramid), found
    document = tile_index(path, identified, found)
    assert document is not None
    return path, document


def offsets_of(entry: dict[str, Any]) -> list[int]:
    offsets: list[int] = []
    end = 0
    for gap, count in zip(entry["tileOffsetGaps"], entry["tileByteCounts"], strict=True):
        offsets.append(end + gap)
        end = offsets[-1] + count
    return offsets


@pytest.mark.parametrize("name", CONTRACT_FIXTURES)
def test_the_committed_sidecar_is_what_the_writer_produces(name: str) -> None:
    _, document = indexed(name)
    written = index_document(document)
    golden = GOLDEN / f"{name}.json"
    if os.environ.get("PARFOCAL_UPDATE_GOLDEN") == "1":
        golden.parent.mkdir(parents=True, exist_ok=True)
        golden.write_bytes(written)
    assert json.loads(golden.read_bytes()) == json.loads(written)


@pytest.mark.parametrize("name", CONTRACT_FIXTURES + CACHED)
def test_every_level_names_its_directory_and_tiles_exactly(name: str) -> None:
    path, document = indexed(name)
    with tifffile.TiffFile(path) as tiff:
        series = main_series(tiff)
        assert series is not None
        stored = {
            page.offset: page for level in series.levels for page in level.pages if page is not None
        }
        for level in document["levels"]:
            for entry in (level, *level["siblings"]):
                page = stored[entry["ifdOffset"]]
                assert offsets_of(entry) == [int(offset) for offset in page.dataoffsets]
                assert entry["tileByteCounts"] == [int(count) for count in page.databytecounts]
                where = tiff.pages[entry["page"]]
                assert where is not None
                if entry["subIfd"] is None:
                    assert where.offset == entry["ifdOffset"]
                else:
                    assert where.subifds is not None
                    assert where.subifds[entry["subIfd"]] == entry["ifdOffset"]


def test_the_ome_pyramid_in_subifds_is_named_by_subifd() -> None:
    _, document = indexed("synthetic-zlib.ome.tiff")
    assert [(level["page"], level["subIfd"]) for level in document["levels"]] == [
        (0, None),
        (0, 0),
        (0, 1),
    ]


def test_channel_pages_are_listed_as_siblings() -> None:
    _, document = indexed("synthetic-channels-uint8.ome.tiff")
    assert [len(level["siblings"]) for level in document["levels"]] == [2, 2, 2]
    assert document["micronsPerPixel"] is not None


def test_an_absent_tile_keeps_a_zero_byte_count() -> None:
    _, document = indexed("synthetic-sparse.tiff")
    counts = document["levels"][0]["tileByteCounts"]
    assert [index for index, count in enumerate(counts) if count == 0] == [1, 6, 7]


def test_philips_sparse_tiles_keep_a_zero_byte_count() -> None:
    _, document = indexed("Philips-4.tiff")
    levels = document["levels"][:3]
    zero = [sum(1 for count in level["tileByteCounts"] if count == 0) for level in levels]
    assert zero == [12710, 3135, 774]


def test_offsets_round_trip_through_gaps() -> None:
    offsets = [100, 150, 0, 400, 300]
    counts = [50, 200, 0, 10, 20]
    gaps = offset_gaps(offsets, counts)
    assert gaps == [100, 0, -350, 400, -110]
    assert offsets_of({"tileOffsetGaps": gaps, "tileByteCounts": counts}) == offsets


def test_formats_outside_the_tiff_family_and_archives_get_no_sidecar(tmp_path: Path) -> None:
    path = fixture_path("synthetic-jpeg.tiff")
    found = read_pyramid(path, Identified(Format.GENERIC_TIFF))
    assert isinstance(found, Pyramid)
    assert tile_index(path, Identified(Format.MIRAX), found) is None
    assert tile_index(path, Identified(Format.GENERIC_TIFF, "zip"), found) is None


def test_no_description_or_label_bytes_reach_the_sidecar() -> None:
    _, document = indexed("synthetic-zlib.ome.tiff")
    text = index_document(document).decode()
    assert "OME" not in text
    assert "ImageDescription" not in text


def test_an_ndpi_restart_interval_decodes_as_its_own_jpeg() -> None:
    path, document = indexed("CMU-1.ndpi")
    assert document["tileKind"] == "ndpi-restart"
    level = next(level for level in document["levels"] if len(level["tileByteCounts"]) > 1)
    header = base64.b64decode(level["jpegHeader"])
    index = len(level["tileByteCounts"]) // 2
    offset = offsets_of(level)[index]
    with path.open("rb") as handle:
        handle.seek(offset)
        segment = handle.read(level["tileByteCounts"][index])
    image = Image.open(io.BytesIO(header + segment[:-2] + JPEG_END))
    assert image.size == (level["tileWidth"], level["tileHeight"])
    image.load()


def test_bif_frames_get_a_stitching_layout_from_the_level_zero_packet() -> None:
    _, document = indexed("OS-1.bif")
    stitching = document["stitching"]
    assert document["tileKind"] == "bif-frames"
    assert (stitching["columns"], stitching["rows"]) == (116, 75)
    assert (stitching["frameWidth"], stitching["frameHeight"]) == (1024, 1360)
    assert len(stitching["columnX"]) == 116
    assert len(stitching["rowY"]) == 75
    assert stitching["width"] < 116 * 1024
    assert stitching["height"] < 75 * 1360
    assert stitching["columnX"] == sorted(stitching["columnX"])
    assert stitching["advanceX"] == pytest.approx(1024 - 112.797423, abs=1e-5)
    assert stitching["advanceY"] == pytest.approx(1360 - 108.778251, abs=1e-5)


def test_frames_are_numbered_from_the_bottom_left_in_a_serpentine() -> None:
    assert frame_cell(1, 3, 2) == (0, 1)
    assert frame_cell(3, 3, 2) == (2, 1)
    assert frame_cell(4, 3, 2) == (2, 0)
    assert frame_cell(6, 3, 2) == (0, 0)
    assert frame_cell(7, 3, 2) is None


def packet(joints: str, columns: int = 2, rows: int = 2) -> str:
    size = f'NumRows="{rows}" NumCols="{columns}"'
    area = f'<ImageInfo AOIScanned="1" Width="100" Height="80" {size}>'
    return f"<Data>{area}{joints}</Data>"


def test_overlaps_are_weighted_by_confidence_per_boundary() -> None:
    joints = (
        "<TileJointInfo Confidence='3' Tile1='1' Tile2='2' OverlapX='10' OverlapY='0'/>"
        "<TileJointInfo Confidence='1' Tile1='4' Tile2='3' OverlapX='30' OverlapY='0'/>"
        "<TileJointInfo Confidence='2' Tile1='1' Tile2='4' OverlapX='0' OverlapY='8'/>"
        "<TileJointInfo Confidence='0' Tile1='2' Tile2='3' OverlapX='0' OverlapY='50'/>"
    )
    stitching = bif_stitching(packet(joints), 100, 80)
    assert stitching is not None
    assert stitching["columnX"] == [0.0, 85.0]
    assert stitching["rowY"] == [0.0, 72.0]
    assert (stitching["advanceX"], stitching["advanceY"]) == (85.0, 72.0)
    assert (stitching["width"], stitching["height"]) == (185, 152)


def test_a_grid_with_nothing_to_correct_has_no_layout() -> None:
    joints = "<TileJointInfo Confidence='5' Tile1='1' Tile2='2' OverlapX='0' OverlapY='0'/>"
    assert bif_stitching(packet(joints), 100, 80) is None
    assert bif_stitching(packet(joints), 64, 80) is None
    assert bif_stitching(packet(""), 100, 80) is None


def test_the_document_is_compact_json() -> None:
    _, document = indexed("synthetic-jpeg.tiff")
    written = index_document(document)
    assert b" " not in written
    assert json.loads(written) == document
