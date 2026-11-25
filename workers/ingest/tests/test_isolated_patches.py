import io
import json
import math
import shutil
import uuid
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import openslide
import pytest
import tifffile
from fixture_support import fixture_path
from test_patch_export import CLASSES, FEATURES, LEVEL, SLIDE, TASK, TILE

from parfocal_common.ingest import original_key
from parfocal_common.jobs import StepFailedError, StepRun
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_ingest.isolation import MAX_MESSAGE_BYTES
from parfocal_ingest.patch_export import (
    COCO,
    CUT_FAILED,
    PatchWriter,
    isolated_slide,
    source_of,
)
from parfocal_ingest.workflow import Resources

TENANT = uuid.UUID(int=3)
SLIDE_ID = uuid.UUID(int=7)
KEY = original_key(TENANT, SLIDE_ID, SLIDE)
GEOJSON = json.dumps({"type": "FeatureCollection", "features": FEATURES}).encode()


class Store:
    async def download(self, key: str, target: Path) -> None:
        assert key == KEY
        shutil.copyfile(fixture_path(SLIDE), target)


def refuse_to_read(*_arguments: Any, **_keywords: Any) -> None:
    raise AssertionError("a slide reader ran inside the worker")


def step_of(job: uuid.UUID, export: str = "masks") -> StepRun:
    found = SimpleNamespace(
        job_id=job,
        tenant_id=TENANT,
        input={"level": LEVEL, "tile_size": TILE, "format": export},
    )
    return cast("StepRun", found)


def resources_in(folder: Path) -> Resources:
    return Resources(StorageLocation("http://unused", "auto", "bucket", "key", "secret"), folder)


def written(writer: PatchWriter, target: io.BytesIO) -> dict[str, bytes]:
    writer.finish(TASK, CLASSES)
    with zipfile.ZipFile(target) as archive:
        return {name: archive.read(name) for name in archive.namelist() if name != "manifest.json"}


def leftovers(folder: Path) -> list[Path]:
    return list(folder.glob("*/*"))


async def isolated(tmp_path: Path) -> tuple[dict[str, Any], bytes]:
    store = cast("ObjectStore", Store())
    step = step_of(uuid.uuid4())
    facts, part = await isolated_slide(step, resources_in(tmp_path), store, SLIDE_ID, KEY, GEOJSON)
    return dict(facts), part


async def test_patch_tiles_are_read_in_the_parse_process_and_match_the_worker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = source_of(SLIDE_ID, fixture_path(SLIDE), GEOJSON)
    assert source is not None
    direct = io.BytesIO()
    expected = PatchWriter(direct, LEVEL, TILE)
    expected.add(source)
    monkeypatch.setattr(openslide.OpenSlide, "__init__", refuse_to_read)
    monkeypatch.setattr(tifffile.TiffFile, "__init__", refuse_to_read)
    facts, part = await isolated(tmp_path)
    merged = io.BytesIO()
    writer = PatchWriter(merged, LEVEL, TILE)
    writer.merge(SLIDE_ID, GEOJSON, facts, part)
    assert writer.skipped == []
    assert writer.rows == expected.rows
    assert writer.slides == expected.slides
    assert written(writer, merged) == written(expected, direct)
    assert leftovers(tmp_path) == []


async def test_a_slide_without_objects_cuts_no_tile_and_still_merges(tmp_path: Path) -> None:
    empty = json.dumps({"type": "FeatureCollection", "features": []}).encode()
    store = cast("ObjectStore", Store())
    step = step_of(uuid.uuid4())
    facts, part = await isolated_slide(step, resources_in(tmp_path), store, SLIDE_ID, KEY, empty)
    merged = io.BytesIO()
    writer = PatchWriter(merged, LEVEL, TILE)
    writer.merge(SLIDE_ID, empty, dict(facts), part)
    assert writer.skipped == []
    assert [(slide.slide_id, slide.tiles) for slide in writer.slides] == [(SLIDE_ID, 0)]
    assert writer.rows == []


def tampered(part: bytes, name: str, data: bytes) -> bytes:
    target = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(part)) as source, zipfile.ZipFile(target, "w") as archive:
        for info in source.infolist():
            archive.writestr(info, source.read(info))
        archive.writestr(name, data)
    return target.getvalue()


async def test_a_parse_process_cannot_slip_other_files_or_rows_into_the_export(
    tmp_path: Path,
) -> None:
    facts, part = await isolated(tmp_path)
    other = uuid.UUID(int=8)
    foreign_row = [f"tiles/{other}/0_0.png", f"masks/{other}/0_0.png", str(other), 1, 2, 0, 0]
    attempts = [
        (facts, tampered(part, "../../secrets.txt", b"x")),
        (facts, tampered(part, f"tiles/{other}/0_0.png", b"x")),
        ({**facts, "rows": [*facts["rows"], [*foreign_row, 10, 10, ""]]}, part),
        ({**facts, "slide": {**facts["slide"], "slide_id": str(other)}}, part),
        ({**facts, "rows": "not rows"}, part),
        (facts, b"not a zip"),
    ]
    for found, archive in attempts:
        writer = PatchWriter(io.BytesIO(), LEVEL, TILE)
        with pytest.raises(StepFailedError) as failure:
            writer.merge(SLIDE_ID, GEOJSON, found, archive)
        assert failure.value.code == CUT_FAILED
        assert writer.skipped == []
        assert writer.rows == []
        assert writer.archive.namelist() == []
        writer.archive.close()


def square_grid(count: int, width: int, height: int) -> list[dict[str, Any]]:
    columns = 100
    step_x, step_y = width / columns, height / math.ceil(count / columns)
    features: list[dict[str, Any]] = []
    for index in range(count):
        x = (index % columns) * step_x + 0.2 * step_x
        y = (index // columns) * step_y + 0.2 * step_y
        side = 0.6 * min(step_x, step_y)
        ring = [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {"parfocal": {"kind": "region", "class_key": 1, "id": f"a-{index}"}},
            }
        )
    return features


async def test_a_coco_cut_of_ten_thousand_annotations_keeps_every_one(tmp_path: Path) -> None:
    count = 10_000
    geojson = json.dumps(
        {"type": "FeatureCollection", "features": square_grid(count, 1024, 768)}
    ).encode()
    store = cast("ObjectStore", Store())
    step = step_of(uuid.uuid4(), "coco")
    facts, part = await isolated_slide(step, resources_in(tmp_path), store, SLIDE_ID, KEY, geojson)
    assert len(json.dumps(facts)) > MAX_MESSAGE_BYTES
    merged = io.BytesIO()
    writer = PatchWriter(merged, LEVEL, TILE, coco=True)
    writer.merge(SLIDE_ID, geojson, facts, part)
    writer.finish(TASK, CLASSES)
    with zipfile.ZipFile(merged) as archive:
        coco = json.loads(archive.read(COCO))
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["skipped"] == []
    assert {item["parfocal_id"] for item in coco["annotations"]} == {
        f"a-{index}" for index in range(count)
    }
    assert len(coco["images"]) == manifest["tiles"] > 0
    assert leftovers(tmp_path) == []


async def test_a_cut_that_breaks_fails_instead_of_skipping_the_slide(tmp_path: Path) -> None:
    store = cast("ObjectStore", Store())
    step = step_of(uuid.uuid4(), "coco")
    with pytest.raises(StepFailedError) as failure:
        await isolated_slide(step, resources_in(tmp_path), store, SLIDE_ID, KEY, b"not json")
    assert failure.value.code == CUT_FAILED
    assert leftovers(tmp_path) == []
