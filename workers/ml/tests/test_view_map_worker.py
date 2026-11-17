import uuid
from contextlib import AsyncExitStack
from pathlib import Path

import httpx2
import numpy as np
import pytest
from tumor_map_support import STORED_SLIDE, CentreScorer, opener
from view_map_support import view_slide

from parfocal_common.object_store import Downloaded, ObjectStore
from parfocal_common.view_maps import TILE_CELLS, ViewTile, cells_in, seconds_in
from parfocal_ml.gpu_pool import POOLS, Family, cpu_stand_in
from parfocal_ml.modal_pool import default_runners, pool_entry
from parfocal_ml.priority_gate import Kind
from parfocal_ml.tumor_map import Scorer
from parfocal_ml.tumor_map_job import SlideOpener
from parfocal_ml.tumor_map_worker import OnnxTumorScorer, local_weights
from parfocal_ml.view_map import view_tile_values
from parfocal_ml.view_map_worker import ViewMapService, stored_opener

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
SLIDE = uuid.UUID("00000000-0000-4000-8000-000000000002")
EMBEDDER = next(pool for pool in POOLS if pool.family is Family.EMBEDDER)


def first_tile_call(tenant: uuid.UUID = TENANT, slide: uuid.UUID = SLIDE) -> dict[str, object]:
    return ViewTile(tenant, slide, 0, 0).call()


class CountedSetup:
    def __init__(self, open_slide: SlideOpener, scorer: Scorer) -> None:
        self.ready = (open_slide, scorer)
        self.count = 0

    async def __call__(self, stack: AsyncExitStack) -> tuple[SlideOpener, Scorer]:
        self.count += 1
        return self.ready


def answered_through_the_pool(scorer: Scorer) -> tuple[dict[str, object], CountedSetup]:
    setup = CountedSetup(opener(view_slide()), scorer)
    service = ViewMapService(setup)
    entry = pool_entry(cpu_stand_in(EMBEDDER, max_containers=1), {Kind.VIEW_MAP: service.answer})
    try:
        entry(first_tile_call())
        return entry(first_tile_call()), setup
    finally:
        service.close()


def test_only_the_embedder_pool_answers_view_maps() -> None:
    families = {pool.family for pool in POOLS if Kind.VIEW_MAP in default_runners(pool)}
    assert families == {Family.EMBEDDER}


def test_the_embedder_pool_answers_a_view_tile_with_256_cells() -> None:
    reply, setup = answered_through_the_pool(CentreScorer())
    assert reply["family"] == "embedder"
    assert reply["kind"] == "view-map"
    cells = cells_in(reply, TILE_CELLS, TILE_CELLS)
    assert cells is not None
    assert len(cells) == 256
    expected = view_tile_values(view_slide(), CentreScorer(), 0, 0)
    assert cells == expected.tobytes()
    assert setup.count == 1
    seconds = seconds_in(reply)
    assert seconds is not None
    assert seconds > 0


@pytest.mark.weights
def test_the_resnet18_answers_a_view_tile_through_the_pool_on_cpu() -> None:
    weights = local_weights()
    if weights is None:
        pytest.skip(
            "camelyon-tumor.onnx is not exported, run workers/ml/spike/export_tumor_onnx.py"
        )
    pytest.importorskip("onnxruntime")
    reply, _ = answered_through_the_pool(OnnxTumorScorer(weights))
    cells = cells_in(reply, TILE_CELLS, TILE_CELLS)
    assert cells is not None
    assert len(cells) == 256
    values = np.frombuffer(cells, np.uint8)
    assert values.max() > 0


def test_a_stored_slide_answers_its_edge_tile_and_is_downloaded_once(tmp_path: Path) -> None:
    pytest.importorskip("openslide")
    from test_stored_slides import LOCAL_STORAGE, stored

    tenant, slide = uuid.uuid4(), uuid.uuid4()
    downloads: list[str] = []

    async def setup(stack: AsyncExitStack) -> tuple[SlideOpener, Scorer]:
        http = await stack.enter_async_context(httpx2.AsyncClient(timeout=60.0))
        storage = ObjectStore(LOCAL_STORAGE, http)
        try:
            await storage.create_bucket()
        except httpx2.TransportError:
            pytest.skip(f"MinIO is not running at {LOCAL_STORAGE.endpoint}")

        async def cleaned() -> None:
            for key in await storage.list_keys(f"t/{tenant}/"):
                await storage.delete_object(key)

        stack.push_async_callback(cleaned)
        await stored(storage, tenant, slide, STORED_SLIDE, None)
        download = storage.download

        async def counted(key: str, target: Path) -> Downloaded:
            downloads.append(key)
            return await download(key, target)

        storage.download = counted
        return await stored_opener(storage, tmp_path, stack), CentreScorer()

    service = ViewMapService(setup)
    try:
        first = service.answer(first_tile_call(tenant, slide))
        again = service.answer(first_tile_call(tenant, slide))
    finally:
        service.close()
    assert (first["width"], first["height"]) == (9, 12)
    assert cells_in(first, 9, 12) is not None
    assert cells_in(again, 9, 12) == cells_in(first, 9, 12)
    assert len(downloads) == 1
    assert not any(path.is_file() for path in tmp_path.rglob("*"))
