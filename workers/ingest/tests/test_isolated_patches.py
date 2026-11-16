import io
import json
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
from parfocal_common.jobs import StepRun
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_ingest.patch_export import PatchWriter, isolated_slide, source_of
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


def step_of(job: uuid.UUID) -> StepRun:
    found = SimpleNamespace(job_id=job, tenant_id=TENANT, input={"level": LEVEL, "tile_size": TILE})
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
        writer.merge(SLIDE_ID, GEOJSON, found, archive)
        assert [item.reason for item in writer.skipped] == ["unreadable"]
        assert writer.rows == []
        assert writer.archive.namelist() == []
