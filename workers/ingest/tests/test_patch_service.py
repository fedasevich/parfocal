import shutil
from pathlib import Path

import numpy as np
import pytest
from fixture_support import ROOT, fixture_path
from PIL import Image

from parfocal_ingest.conversion import Chunks, write_store
from parfocal_ingest.patch_service import (
    LruCache,
    OpenSlideSource,
    PatchService,
    Region,
    TiledTiffSource,
    ZarrSource,
    open_source,
    plan,
)
from parfocal_ingest.zarr_index import UnsupportedZarrError

REFERENCE = ROOT / "packages" / "test-fixtures" / "reference-tiles"
SVS = "CMU-1-Small-Region.svs"
NDPI = "CMU-1.ndpi"


def mean_difference(first: np.ndarray, second: np.ndarray) -> float:
    return float(np.abs(first.astype(np.int16) - second.astype(np.int16)).mean())


@pytest.fixture(scope="module")
def svs_store(tmp_path_factory: pytest.TempPathFactory) -> Path:
    folder = tmp_path_factory.mktemp("patch-store")
    store = folder / "slide.ome.zarr"
    write_store(fixture_path(SVS), store, folder / "work", chunks=Chunks.ZSTD)
    return store


def test_the_same_128_micron_patch_reads_alike_from_svs_and_ome_zarr(svs_store: Path) -> None:
    path = fixture_path(SVS)
    service = PatchService()
    from_svs = service.patch(path, 1100, 1400)
    from_zarr = service.patch(svs_store, 1100, 1400)
    assert isinstance(service.source(path), TiledTiffSource)
    assert isinstance(service.source(svs_store), ZarrSource)
    assert from_svs is not None
    assert from_zarr is not None
    assert from_svs.shape == from_zarr.shape == (256, 256, 3)
    assert mean_difference(from_svs, from_zarr) == 0.0
    service.close()


def test_the_stored_tiles_decode_like_openslide(svs_store: Path) -> None:
    path = fixture_path(SVS)
    tiled = open_source(path)
    slide = OpenSlideSource(path, tiled.mpp)
    region = Region(0, 900, 1150, 400, 300)
    from_tiles = tiled.region(region)
    from_openslide = slide.region(region)
    assert from_tiles is not None
    assert from_openslide is not None
    assert mean_difference(from_tiles, from_openslide) < 0.5
    tiled.close()
    slide.close()


def test_a_coarse_patch_comes_from_a_coarser_zarr_level_and_still_matches(svs_store: Path) -> None:
    service = PatchService()
    source = service.source(svs_store)
    chosen = plan(source, 1100, 1400, 128, 64)
    assert chosen.region.level == 2
    from_zarr = service.patch(svs_store, 1100, 1400, 128, 64)
    from_svs = service.patch(fixture_path(SVS), 1100, 1400, 128, 64)
    assert from_zarr is not None
    assert from_svs is not None
    assert from_zarr.shape == from_svs.shape == (64, 64, 3)
    assert mean_difference(from_zarr, from_svs) < 2.0
    service.close()


def test_the_ndpi_patch_matches_the_committed_reference_tile() -> None:
    path = fixture_path(NDPI)
    source = open_source(path)
    assert isinstance(source, OpenSlideSource)
    reference = np.asarray(Image.open(REFERENCE / NDPI / "level-0-34688-19040.png").convert("RGB"))
    read = source.region(Region(0, 34688, 19040, 256, 64))
    assert read is not None
    assert mean_difference(read, reference) == 0.0
    source.close()


def test_the_same_128_micron_ndpi_patch_reads_alike_from_fine_and_coarse_levels() -> None:
    path = fixture_path(NDPI)
    service = PatchService()
    source = service.source(path)
    x, y = 34688 + 128, 19040 + 32
    fine = plan(source, x, y, 128, round(128 / source.mpp))
    coarse = plan(source, x, y, 128, 64)
    assert fine.region.level == 0
    assert coarse.region.level > 0
    full = service.patch(path, x, y, 128, round(128 / source.mpp))
    small = service.patch(path, x, y, 128, 64)
    assert full is not None
    assert small is not None
    reduced = np.asarray(Image.fromarray(full).resize((64, 64), Image.Resampling.BOX))
    shifted = service.patch(path, x + 8 / source.mpp, y, 128, 64)
    assert shifted is not None
    aligned = mean_difference(small, reduced)
    assert aligned < 6.0
    assert mean_difference(shifted, reduced) > 2 * aligned
    service.close()


def test_an_absent_sparse_tile_gives_no_patch() -> None:
    path = fixture_path("synthetic-sparse.tiff")
    service = PatchService()
    assert service.patch(path, 384, 128) is None
    present = service.patch(path, 128, 128)
    assert present is not None
    assert present.shape == (256, 256, 3)
    service.close()


def test_a_missing_zarr_chunk_is_sparse(svs_store: Path, tmp_path: Path) -> None:
    store = tmp_path / "sparse.ome.zarr"
    shutil.copytree(svs_store, store)
    (store / "0" / "c" / "0" / "1" / "1").unlink()
    source = ZarrSource(store, 8)
    assert source.region(Region(0, 600, 600, 64, 64)) is None
    straddling = source.region(Region(0, 480, 480, 64, 64))
    assert straddling is not None
    assert (straddling[32:, 32:] == 255).all()
    assert not (straddling[:32, :32] == 255).all()


def test_the_same_patch_reads_alike_from_a_jpeg_tiff_and_its_jpeg_ome_zarr() -> None:
    service = PatchService()
    from_tiff = service.patch(fixture_path("synthetic-jpeg.tiff"), 512, 384, 128, 128)
    store = fixture_path("synthetic-jpeg-converted.ome.zarr")
    from_zarr = service.patch(store, 512, 384, 128, 128)
    assert isinstance(service.source(store), ZarrSource)
    assert from_tiff is not None
    assert from_zarr is not None
    assert mean_difference(from_tiff, from_zarr) < 3.0
    service.close()


def test_a_zarr_version_2_store_is_refused_plainly() -> None:
    with pytest.raises(UnsupportedZarrError):
        open_source(fixture_path("synthetic-jpeg.ome.zarr"))


def test_a_repeated_patch_is_served_from_the_tile_cache() -> None:
    path = fixture_path(SVS)
    service = PatchService()
    first = service.patch(path, 1100, 1400)
    source = service.source(path)
    assert isinstance(source, TiledTiffSource)
    misses = source.tiles.misses
    second = service.patch(path, 1100, 1400)
    assert source.tiles.misses == misses
    assert source.tiles.hits > 0
    assert first is not None
    assert second is not None
    assert np.array_equal(first, second)
    service.close()


def test_the_cache_drops_the_least_recently_used_entry() -> None:
    cache: LruCache[str, int] = LruCache(2)
    for key in ("a", "b", "a", "c"):
        cache.get(key, ord)
    assert list(cache.entries) == ["a", "c"]
    assert cache.entries["a"] == ord("a")
    assert cache.hits == 1
    assert cache.misses == 3
