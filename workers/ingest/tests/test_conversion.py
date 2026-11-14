import io
import json
from collections.abc import Callable
from compression import zstd
from pathlib import Path
from typing import Any

import numpy as np
import openslide
import pytest
import tifffile
from fixture_support import SYNTHETIC, fixture_path
from PIL import Image, JpegImagePlugin

from parfocal_ingest.conversion import (
    CHUNK,
    JPEG_CODEC,
    Chunks,
    Converted,
    NotTriggeredError,
    Trigger,
    convert,
    level_plan,
    trigger_for,
    write_store,
)
from parfocal_ingest.identify import Format, identify
from parfocal_ingest.pyramid import Pyramid, Reader, Stored, ladder, main_series, read_pyramid
from parfocal_ingest.reference_tiles import Window, read_window
from parfocal_ingest.source_levels import planar, ycbcr_to_rgb
from parfocal_ingest.thumbnail import background_of, flattened
from parfocal_ingest.zarr_index import zarr_tile_index

SMALL_CHUNK = 256
TOLERANCE = 1.0
FULL_CHROMA = 0
CANDIDATE_CORNERS = 24
SHIFT = 2
MARGIN = 2
TRIGGER_FIXTURE = "JP2K-33003-1.svs"
FORCED_LOSSLESS = "#lossless"
JPEG_BRIGHTFIELD = ["synthetic-jpeg.tiff", "synthetic-zlib.ome.tiff"]
BRIGHTFIELD = [TRIGGER_FIXTURE, *JPEG_BRIGHTFIELD]
LOSSLESS_BRIGHTFIELD = [TRIGGER_FIXTURE] + [name + FORCED_LOSSLESS for name in JPEG_BRIGHTFIELD]
LOSSLESS = ["synthetic-channels-uint16.ome.tiff", "synthetic-mxif-uint16-be.ome.tiff"]
COMPARE_ROWS = 512
OPENSLIDE_UNSPLIT = 4096
FIRED = {Trigger.JPEG2000_DECODE_BUDGET}
COMMITTED = {
    "synthetic-jpeg.tiff": "synthetic-jpeg-converted.ome.zarr",
    "synthetic-channels-uint16.ome.tiff": "synthetic-channels-uint16-converted.ome.zarr",
}

type Convert = Callable[[str], Converted]


def opened(name: str) -> tuple[Path, Format, Pyramid]:
    path = fixture_path(name)
    with path.open("rb") as handle:
        found = identify(handle, path.name)
    assert found.format is not None
    pyramid = read_pyramid(path, found)
    assert isinstance(pyramid, Pyramid), pyramid
    return path, found.format, pyramid


@pytest.fixture(scope="module")
def stores(tmp_path_factory: pytest.TempPathFactory) -> Convert:
    made: dict[str, Converted] = {}

    def make(name: str) -> Converted:
        if name not in made:
            slide = name.removesuffix(FORCED_LOSSLESS)
            path = fixture_path(slide)
            folder = tmp_path_factory.mktemp("converted")
            store = folder / f"{slide}.ome.zarr"
            if slide == TRIGGER_FIXTURE:
                made[name] = convert(
                    path, store, folder / "work", Trigger.JPEG2000_DECODE_BUDGET, FIRED
                )
            else:
                chunks = Chunks.ZSTD if name.endswith(FORCED_LOSSLESS) else None
                made[name] = write_store(
                    path, store, folder / "work", chunk=SMALL_CHUNK, chunks=chunks
                )
        return made[name]

    return make


def array_meta(store: Path, level: int) -> dict[str, Any]:
    return json.loads((store / str(level) / "zarr.json").read_text())


def chunk_shape(store: Path) -> list[int]:
    return array_meta(store, 0)["chunk_grid"]["configuration"]["chunk_shape"]


def decoded(store: Path, level: int, row: int, column: int) -> np.ndarray:
    meta = array_meta(store, level)
    channels, height, width = meta["chunk_grid"]["configuration"]["chunk_shape"]
    body = (store / str(level) / "c" / "0" / str(row) / str(column)).read_bytes()
    if meta["codecs"][1]["name"] == JPEG_CODEC:
        return np.asarray(Image.open(io.BytesIO(body))).transpose(2, 0, 1)
    dtype = np.dtype(meta["data_type"]).newbyteorder("<")
    return np.frombuffer(zstd.decompress(body), dtype=dtype).reshape(channels, height, width)


def store_window(store: Path, level: int, x: int, y: int, width: int, height: int) -> np.ndarray:
    meta = array_meta(store, level)
    _, tall, wide = meta["chunk_grid"]["configuration"]["chunk_shape"]
    out = np.zeros((meta["shape"][0], height, width), dtype=np.dtype(meta["data_type"]))
    for row in range(y // tall, (y + height - 1) // tall + 1):
        for column in range(x // wide, (x + width - 1) // wide + 1):
            block = decoded(store, level, row, column)
            top, left = row * tall, column * wide
            y0, y1 = max(y, top), min(y + height, top + tall)
            x0, x1 = max(x, left), min(x + width, left + wide)
            out[:, y0 - y : y1 - y, x0 - x : x1 - x] = block[
                :, y0 - top : y1 - top, x0 - left : x1 - left
            ]
    return out


def averaged(pixels: np.ndarray, factor: int) -> np.ndarray:
    channels, height, width = pixels.shape
    blocks = pixels.astype(np.float64).reshape(
        channels, height // factor, factor, width // factor, factor
    )
    return blocks.mean(axis=(2, 4))


def mean_error(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.abs(a.astype(np.float64) - b.astype(np.float64)).mean())


def shifted(around: np.ndarray, dx: int, dy: int, side: int) -> np.ndarray:
    return around[:, SHIFT + dy : SHIFT + dy + side, SHIFT + dx : SHIFT + dx + side]


def textured_corner(store: Path, level: int) -> tuple[int, int, int]:
    meta = array_meta(store, level)
    _, tall, wide = meta["chunk_grid"]["configuration"]["chunk_shape"]
    rows, columns = -(-meta["shape"][1] // tall), -(-meta["shape"][2] // wide)
    side = min(tall, wide) // 2
    corners = [
        (column * wide, row * tall) for row in range(1, rows) for column in range(1, columns)
    ]
    corners = [
        (x, y) for x, y in corners if x + side <= meta["shape"][2] and y + side <= meta["shape"][1]
    ]
    assert corners, "the level has no inner chunk corner"
    corners = corners[:: max(1, len(corners) // CANDIDATE_CORNERS)]
    texture = [
        float(store_window(store, level, x - side // 2, y - side // 2, side, side).std())
        for x, y in corners
    ]
    x, y = corners[int(np.argmax(texture))]
    return x - side // 2, y - side // 2, side


def test_nothing_converts_until_a_trigger_fires(tmp_path: Path) -> None:
    _, _, pyramid = opened("synthetic-jpeg.tiff")
    assert trigger_for(pyramid) is None
    with pytest.raises(NotTriggeredError):
        convert(
            fixture_path("synthetic-jpeg.tiff"),
            tmp_path / "out.ome.zarr",
            tmp_path / "work",
            Trigger.JPEG2000_DECODE_BUDGET,
        )
    assert not (tmp_path / "out.ome.zarr").exists()


def test_a_fired_trigger_refuses_a_slide_it_does_not_cover(tmp_path: Path) -> None:
    with pytest.raises(NotTriggeredError):
        convert(
            fixture_path("synthetic-jpeg.tiff"),
            tmp_path / "out.ome.zarr",
            tmp_path / "work",
            Trigger.JPEG2000_DECODE_BUDGET,
            FIRED,
        )
    assert not (tmp_path / "out.ome.zarr").exists()


def test_the_jpeg2000_trigger_picks_only_jpeg2000_slides() -> None:
    assert trigger_for(opened(TRIGGER_FIXTURE)[2], FIRED) is Trigger.JPEG2000_DECODE_BUDGET
    assert trigger_for(opened(TRIGGER_FIXTURE)[2]) is None
    for name in ("synthetic-jpeg.tiff", "synthetic-channels-uint16.ome.tiff"):
        assert trigger_for(opened(name)[2], FIRED) is None


def test_a_fired_trigger_converts_the_trigger_fixture(stores: Convert) -> None:
    done = stores(TRIGGER_FIXTURE)
    assert done.trigger is Trigger.JPEG2000_DECODE_BUDGET
    assert done.chunks is Chunks.ZSTD
    assert done.from_source == (True, False, True, True, False, False, False)
    assert chunk_shape(done.store) == [3, CHUNK, CHUNK]
    assert (done.store / "zarr.json").exists()
    assert not (done.store.parent / "work").exists()
    assert not done.store.with_name(done.store.name + ".partial").exists()


def test_the_level_plan_takes_each_level_the_source_has() -> None:
    plan = level_plan({1, 4, 8}, 15374, 17497, CHUNK)
    assert [step.downsample for step in plan] == [1, 2, 4, 8, 16, 32, 64]
    assert [step.from_source for step in plan] == [True, False, True, True, False, False, False]
    assert [step.downsample for step in level_plan({1}, 512, 300, CHUNK)] == [1]


def test_ycbcr_follows_the_openslide_tables() -> None:
    luma, cb, cr = np.meshgrid(np.arange(0, 256, 15), np.arange(0, 256, 15), np.arange(0, 256, 15))
    pixels = np.stack([luma, cb, cr], axis=-1).astype(np.uint8)
    rgb = ycbcr_to_rgb(pixels).astype(np.float64)
    y, u, v = (pixels[..., k].astype(np.float64) for k in range(3))
    exact = np.clip(
        np.stack(
            [
                y + 1.402 * (v - 128),
                y - 0.344136 * (u - 128) - 0.714136 * (v - 128),
                y + 1.772 * (u - 128),
            ],
            axis=-1,
        ),
        0,
        255,
    )
    assert np.abs(rgb - exact).max() <= 1
    grey = np.full((2, 2, 3), 128, dtype=np.uint8)
    grey[..., 0] = 77
    assert (ycbcr_to_rgb(grey) == 77).all()


@pytest.mark.parametrize("name", LOSSLESS_BRIGHTFIELD)
def test_lossless_brightfield_is_rgb_zstd(name: str, stores: Convert) -> None:
    store = stores(name).store
    meta = array_meta(store, 0)
    assert meta["data_type"] == "uint8"
    assert meta["fill_value"] == 255
    assert meta["codecs"][1]["name"] == "zstd"
    group = json.loads((store / "zarr.json").read_text())["attributes"]["ome"]
    channels = group["omero"]["channels"]
    assert [channel["color"] for channel in channels] == ["FF0000", "00FF00", "0000FF"]
    assert all(channel["window"]["end"] == 255 for channel in channels)


@pytest.mark.parametrize("name", BRIGHTFIELD + LOSSLESS)
def test_the_store_passes_the_level_validation(name: str, stores: Convert) -> None:
    _, _, source = opened(name)
    store = stores(name).store
    index = zarr_tile_index(store)
    stored = [
        Stored(level["width"], level["height"], level["tileWidth"], level["tileHeight"], None, None)
        for level in index["levels"]
    ]
    levels, skipped = ladder(stored)
    assert not skipped
    assert [level.downsample for level in levels] == [2**k for k in range(len(levels))]
    base = source.levels[0]
    assert (levels[0].width, levels[0].height) == (base.width, base.height)
    assert max(levels[-1].width, levels[-1].height) <= chunk_shape(store)[1]
    assert index["zarrVersion"] == 3
    assert all(level["absentTiles"] == [] for level in index["levels"])
    group = json.loads((store / "zarr.json").read_text())["attributes"]["ome"]
    assert group["version"] == "0.5"
    assert [axis["name"] for axis in group["multiscales"][0]["axes"]] == ["c", "y", "x"]
    mpp = source.scale.mpp_x
    assert mpp is not None
    for k, dataset in enumerate(group["multiscales"][0]["datasets"]):
        scale = dataset["coordinateTransformations"][0]["scale"]
        assert scale == pytest.approx([1, mpp * 2**k, mpp * 2**k])


@pytest.mark.parametrize("name", JPEG_BRIGHTFIELD)
def test_brightfield_is_one_jpeg_chunk_of_three_channels(name: str, stores: Convert) -> None:
    store = stores(name).store
    meta = array_meta(store, 0)
    side = chunk_shape(store)[1]
    assert meta["data_type"] == "uint8"
    assert meta["fill_value"] == 255
    assert meta["codecs"][1] == {"name": JPEG_CODEC, "configuration": {"level": 90}}
    image = Image.open(io.BytesIO((store / "0" / "c" / "0" / "0" / "0").read_bytes()))
    assert isinstance(image, JpegImagePlugin.JpegImageFile)
    assert (image.mode, image.size) == ("RGB", (side, side))
    assert JpegImagePlugin.get_sampling(image) == FULL_CHROMA


@pytest.mark.parametrize("name", LOSSLESS)
def test_high_bit_depth_is_lossless_zstd(name: str, stores: Convert) -> None:
    store = stores(name).store
    meta = array_meta(store, 0)
    assert meta["data_type"] == "uint16"
    assert meta["codecs"][1]["name"] == "zstd"
    with tifffile.TiffFile(fixture_path(name)) as tiff:
        series = main_series(tiff)
        assert series is not None
        source = series.levels[0].asarray()
    channels, height, width = source.shape
    assert np.array_equal(store_window(store, 0, 0, 0, width, height), source)
    group = json.loads((store / "zarr.json").read_text())["attributes"]["ome"]
    windows = [channel["window"] for channel in group["omero"]["channels"]]
    assert len(windows) == channels
    assert all(window["start"] < window["end"] <= 65535 for window in windows)


@pytest.mark.parametrize("name", JPEG_BRIGHTFIELD)
def test_the_store_draws_the_source_across_chunk_corners(name: str, stores: Convert) -> None:
    path, found, pyramid = opened(name)
    store = stores(name).store
    for level in (0, 1):
        x, y, side = textured_corner(store, level)
        factor = 2**level
        window = Window(
            0,
            1,
            (x - SHIFT) * factor,
            (y - SHIFT) * factor,
            (side + 2 * SHIFT) * factor,
            (side + 2 * SHIFT) * factor,
        )
        around = averaged(
            np.asarray(read_window(path, found, pyramid, window)).transpose(2, 0, 1), factor
        )
        drawn = store_window(store, level, x, y, side, side).astype(np.float64)
        placed = shifted(around, 0, 0, side)
        error = mean_error(drawn, placed)
        offsets = [
            mean_error(drawn, shifted(around, dx, dy, side))
            for dx in range(-SHIFT, SHIFT + 1)
            for dy in range(-SHIFT, SHIFT + 1)
            if (dx, dy) != (0, 0)
        ]
        assert error * MARGIN < min(offsets), (level, error, min(offsets))
        assert error * MARGIN < mean_error(drawn[::-1], placed), (level, error)
        assert error <= TOLERANCE, (level, error)


def source_rows(
    path: Path, found: Format, pyramid: Pyramid, downsample: int
) -> Callable[[int, int], np.ndarray]:
    level = next(level for level in pyramid.levels if level.downsample == downsample)
    if pyramid.reader is Reader.TIFFFILE:
        with tifffile.TiffFile(path) as tiff:
            series = main_series(tiff)
            assert series is not None
            pixels = planar(series.levels[level.index].asarray(), series.levels[level.index].axes)
        return lambda top, bottom: pixels[:, top:bottom]
    with openslide.OpenSlide(path) as slide:
        index = min(
            range(slide.level_count), key=lambda k: abs(slide.level_downsamples[k] - downsample)
        )
        ds = slide.level_downsamples[index]
        width, height = slide.level_dimensions[index]
        background = background_of(slide)
        if ds != downsample:
            span = (min(width, OPENSLIDE_UNSPLIT), min(height, OPENSLIDE_UNSPLIT))
            region = slide.read_region((0, 0), index, span)
            whole = np.asarray(flattened(region, background)).transpose(2, 0, 1)
            return lambda top, bottom: whole[:, top:bottom]

    def rows(top: int, bottom: int) -> np.ndarray:
        with openslide.OpenSlide(path) as slide:
            region = slide.read_region((0, top * downsample), index, (width, bottom - top))
            return np.asarray(flattened(region, background)).transpose(2, 0, 1)

    return rows


def halved_exactly(finer: np.ndarray, height: int, width: int) -> np.ndarray:
    sums = finer[:, : height * 2, : width * 2].astype(np.uint16)
    sums = sums[:, 0::2, 0::2] + sums[:, 1::2, 0::2] + sums[:, 0::2, 1::2] + sums[:, 1::2, 1::2]
    return np.rint(sums.astype(np.float32) / 4).astype(finer.dtype)


@pytest.mark.parametrize("name", LOSSLESS_BRIGHTFIELD + LOSSLESS)
def test_a_lossless_store_equals_the_source_at_every_level(name: str, stores: Convert) -> None:
    path, found, pyramid = opened(name.removesuffix(FORCED_LOSSLESS))
    done = stores(name)
    for index, from_source in enumerate(done.from_source):
        width, height = done.levels[index]
        downsample = 2**index
        reference = source_rows(path, found, pyramid, downsample) if from_source else None
        for top in range(0, height, COMPARE_ROWS):
            bottom = min(height, top + COMPARE_ROWS)
            drawn = store_window(done.store, index, 0, top, width, bottom - top)
            if reference is not None:
                expected = reference(top, bottom)
                drawn = drawn[:, : expected.shape[1], : expected.shape[2]]
            else:
                finer = store_window(
                    done.store, index - 1, 0, top * 2, width * 2, (bottom - top) * 2
                )
                expected = halved_exactly(finer, bottom - top, width)
            assert np.array_equal(drawn, expected), (index, top)


@pytest.mark.parametrize(("name", "committed"), COMMITTED.items())
def test_the_committed_converted_stores_match_a_fresh_conversion(
    name: str, committed: str, tmp_path: Path
) -> None:
    kept = SYNTHETIC / committed
    store = tmp_path / committed
    write_store(fixture_path(name), store, tmp_path / "work")
    files = sorted(path.relative_to(store) for path in store.rglob("*") if path.is_file())
    assert files == sorted(path.relative_to(kept) for path in kept.rglob("*") if path.is_file())
    group = json.loads((store / "zarr.json").read_text())
    assert group == json.loads((kept / "zarr.json").read_text())
    for level in range(len(group["attributes"]["ome"]["multiscales"][0]["datasets"])):
        meta = array_meta(store, level)
        assert meta == array_meta(kept, level)
        height, width = meta["shape"][1:]
        assert np.array_equal(
            store_window(store, level, 0, 0, width, height),
            store_window(kept, level, 0, 0, width, height),
        )
