from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import cast

import pytest
from test_cell_crops import KEY, SLIDE_ID, TENANT, Store, spot

from parfocal_common.cell_crops import crop_key
from parfocal_common.jobs import StepRun
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_ingest import cell_crop_job
from parfocal_ingest.cell_crop_job import cut_ordered_cells
from parfocal_ingest.cell_crops import CUT, PRESENT, Spot
from parfocal_ingest.workflow import Resources


class Connection:
    async def scalar(self, _statement: object) -> str:
        return KEY


class Step:
    def __init__(self) -> None:
        self.input = {"slide_id": str(SLIDE_ID)}
        self.tenant_id = TENANT

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[Connection]:
        yield Connection()


class StoreOf:
    def __init__(self, store: Store) -> None:
        self.store = store

    def __call__(self, *_arguments: object) -> ObjectStore:
        return cast("ObjectStore", self.store)


async def run_job(
    monkeypatch: pytest.MonkeyPatch, store: Store, work_dir: Path, ordered: list[int]
) -> object:
    async def still_mine(*_arguments: object) -> bool:
        return True

    async def picked_on(*_arguments: object) -> list[Spot]:
        return [spot(number, 0, 50) for number in ordered]

    monkeypatch.setattr(cell_crop_job, "still_mine", still_mine)
    monkeypatch.setattr(cell_crop_job, "picked_on", picked_on)
    resources = Resources(
        storage=cast("StorageLocation", None),
        work_dir=work_dir,
        store_class=cast("type[ObjectStore]", StoreOf(store)),
    )
    return await cut_ordered_cells(cast("StepRun", Step()), resources)


async def test_an_order_job_cuts_only_the_ordered_cells_without_crops(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = Store({crop_key(TENANT, SLIDE_ID, 1)})
    assert await run_job(monkeypatch, store, tmp_path, [1, 2]) == {"state": CUT}
    assert sorted(store.objects) == [crop_key(TENANT, SLIDE_ID, n) for n in (1, 2)]
    assert store.objects[crop_key(TENANT, SLIDE_ID, 1)] == b"old"
    assert store.objects[crop_key(TENANT, SLIDE_ID, 2)].startswith(b"\xff\xd8\xff")


async def test_an_order_job_cuts_nothing_when_every_crop_exists(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = Store({crop_key(TENANT, SLIDE_ID, n) for n in (1, 2)})
    assert await run_job(monkeypatch, store, tmp_path, [1, 2]) == {"state": PRESENT}
    assert store.downloads == 0
