import asyncio
import io
import shutil
import uuid
from pathlib import Path
from typing import cast

import openslide
import pytest
import tifffile
from fixture_support import fixture_path
from PIL import Image

from parfocal_common.cell_crops import CROP_SIDE, crop_folder, crop_key
from parfocal_common.ingest import original_key
from parfocal_common.object_store import ObjectStore, StorageError
from parfocal_ingest.cell_crops import (
    CUT,
    MISSING,
    NONE,
    PRESENT,
    UNREADABLE,
    Spot,
    chosen,
    crop_slide,
    cut_from,
)

SVS = "CMU-1-Small-Region.svs"
TENANT = uuid.UUID(int=3)
SLIDE_ID = uuid.UUID(int=7)
KEY = original_key(TENANT, SLIDE_ID, SVS)


def spot(number: int, class_index: int, score: int) -> Spot:
    return Spot(number, 500.0 + number, 400.0 + number, class_index, score)


def test_each_class_keeps_its_best_cells_and_reviewed_cells_come_first() -> None:
    spots = [spot(number, number % 2, number * 10) for number in range(1, 11)]
    picked = chosen(spots, wanted=[3, 99, 3], per_class=2, cap=100)
    assert [item.number for item in picked] == [3, 9, 7, 10, 8]


def test_the_cap_bounds_the_crops_of_one_slide() -> None:
    spots = [spot(number, number % 5, number) for number in range(1, 400)]
    picked = chosen(spots, wanted=list(range(1, 50)), per_class=100, cap=60)
    assert len(picked) == 60
    assert [item.number for item in picked[:49]] == list(range(1, 50))


def test_a_cell_in_two_sets_is_cut_once() -> None:
    picked = chosen([spot(4, 0, 10), spot(4, 1, 90)], wanted=[], per_class=5, cap=10)
    assert [item.number for item in picked] == [4]


def test_a_crop_is_a_small_jpeg_centred_on_the_cell(tmp_path: Path) -> None:
    made = cut_from(fixture_path(SVS), [[5, 1000.0, 800.0], [6, 1200.0, 900.0]], tmp_path)
    assert made == 2
    image = Image.open(io.BytesIO((tmp_path / "5.jpg").read_bytes()))
    assert image.format == "JPEG"
    assert image.size == (CROP_SIDE, CROP_SIDE)
    assert (tmp_path / "5.jpg").stat().st_size < 16 * 1024


class Store:
    def __init__(self, stored: set[str] | None = None) -> None:
        self.objects: dict[str, bytes] = dict.fromkeys(stored or set(), b"old")
        self.downloads = 0

    async def list_keys(self, prefix: str) -> list[str]:
        return [key for key in self.objects if key.startswith(prefix)]

    async def download(self, key: str, target: Path) -> None:
        assert key == KEY
        self.downloads += 1
        shutil.copyfile(fixture_path(SVS), target)

    async def put_object(self, key: str, body: bytes, _content_type: str) -> None:
        self.objects[key] = body


def refuse_to_read(*_arguments: object, **_keywords: object) -> None:
    raise AssertionError("a slide reader ran inside the worker")


async def test_crops_are_cut_in_the_parse_process_and_stored_under_the_slide(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(openslide.OpenSlide, "__init__", refuse_to_read)
    monkeypatch.setattr(tifffile.TiffFile, "__init__", refuse_to_read)
    store = Store({crop_key(TENANT, SLIDE_ID, 1)})
    picked = [spot(1, 0, 90), spot(2, 0, 80), spot(3, 1, 70)]
    state = await crop_slide(cast("ObjectStore", store), TENANT, SLIDE_ID, KEY, picked, tmp_path)
    assert state == CUT
    assert sorted(store.objects) == sorted(crop_key(TENANT, SLIDE_ID, n) for n in (1, 2, 3))
    assert store.objects[crop_key(TENANT, SLIDE_ID, 1)] == b"old"
    assert store.objects[crop_key(TENANT, SLIDE_ID, 2)].startswith(b"\xff\xd8\xff")
    assert all(key.startswith(crop_folder(TENANT, SLIDE_ID)) for key in store.objects)
    assert await asyncio.to_thread(lambda: list(tmp_path.iterdir())) == []
    again = await crop_slide(cast("ObjectStore", store), TENANT, SLIDE_ID, KEY, picked, tmp_path)
    assert again == PRESENT
    assert store.downloads == 1


async def test_a_slide_without_cells_or_pixels_stores_nothing(tmp_path: Path) -> None:
    store = Store()
    nothing = await crop_slide(cast("ObjectStore", store), TENANT, SLIDE_ID, KEY, [], tmp_path)
    assert nothing == NONE

    class Broken(Store):
        async def download(self, key: str, target: Path) -> None:
            await asyncio.to_thread(target.write_bytes, b"not a slide")

    broken = Broken()
    state = await crop_slide(
        cast("ObjectStore", broken), TENANT, SLIDE_ID, KEY, [spot(1, 0, 9)], tmp_path
    )
    assert state == UNREADABLE
    assert broken.objects == {}


async def test_a_slide_whose_original_is_gone_ends_without_crops(tmp_path: Path) -> None:
    class Gone(Store):
        async def download(self, key: str, target: Path) -> None:
            raise StorageError(404, "NoSuchKey")

    gone = Gone()
    state = await crop_slide(
        cast("ObjectStore", gone), TENANT, SLIDE_ID, KEY, [spot(1, 0, 9)], tmp_path
    )
    assert state == MISSING
    assert gone.objects == {}
    assert await asyncio.to_thread(lambda: list(tmp_path.iterdir())) == []


async def test_other_storage_errors_still_reach_the_job(tmp_path: Path) -> None:
    class Down(Store):
        async def download(self, key: str, target: Path) -> None:
            raise StorageError(503, "SlowDown")

    with pytest.raises(StorageError):
        await crop_slide(
            cast("ObjectStore", Down()), TENANT, SLIDE_ID, KEY, [spot(1, 0, 9)], tmp_path
        )
