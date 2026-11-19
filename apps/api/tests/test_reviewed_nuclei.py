import asyncio
import uuid
from pathlib import Path

import numpy as np
import pytest
from chunk_support import chunk_bytes, put_chunk
from db_support import APP_URL, ApiAs, with_database
from numpy.typing import NDArray
from sqlalchemy.ext.asyncio import create_async_engine
from test_annotations import circle
from test_review_decisions import Called, behind_the_triggers, called, decide
from test_reviewed_layer import edit
from workspace_support import owner

from parfocal_api.reviewed_nuclei import ReviewedNucleusRow, described, flat_ring, reviewed_nuclei
from parfocal_common.chunk_store import chunk_key
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction
from parfocal_common.result_imports import result_set_prefix
from parfocal_ml.reviewed_features import FeatureStore
from parfocal_ml.server_pooling import SlideSource, nuclei_of, pool_reviewed
from parfocal_ml.whole_slide import Window

TYPER = "pathosam-hovernext"
BASE = "v1.2"
CELLS = [(1, 0, 200, 100.0, 100.0), (2, 1, 150, 140.0, 120.0), (3, 0, 90, 400.0, 380.0)]
PROBS = [230, 25, 40, 215, 200, 55]
CLASSES = 2


class MemoryStore:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = objects

    async def get(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def get_packed(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def put(self, object_key: str, data: bytes) -> None:
        self.objects[object_key] = data


class Reader:
    mpp = 0.5

    def __init__(self) -> None:
        self.pixels = np.zeros((1024, 1024, 3), np.uint8)
        self.pixels[..., 0] = np.linspace(0, 255, 1024, dtype=np.uint8)[None, :]
        self.pixels[..., 1] = np.linspace(0, 255, 1024, dtype=np.uint8)[:, None]

    async def read(self, window: Window, width: int, height: int) -> NDArray[np.uint8]:
        return self.pixels[window.y : window.y + height, window.x : window.x + width].copy()


class FakeEncoder:
    def __init__(self) -> None:
        self.weights = np.random.default_rng(5).normal(0, 1, (4, 3)).astype(np.float32)
        self.calls = 0

    def __call__(self, pixels: np.ndarray) -> np.ndarray:
        self.calls += 1
        cells = pixels[0].reshape(3, 64, 16, 64, 16).mean(axis=(2, 4))
        return np.einsum("kc,cyx->kyx", self.weights, cells)[None].astype(np.float32)


def with_cells(database: str, c: Called) -> tuple[uuid.UUID, MemoryStore]:
    tenant = uuid.UUID(
        str(owner(database, f"SELECT tenant_id FROM projects WHERE id = '{c.r.project}'")[0][0])
    )
    key = chunk_key(result_set_prefix(tenant, c.r.slide, c.r.result_set), 0)
    behind_the_triggers(
        database,
        f"DELETE FROM result_chunks WHERE result_set_id = '{c.r.result_set}'; "
        "INSERT INTO result_chunks (tenant_id, result_set_id, chunk, x, y, width, height, "
        f"cell_count, vertex_count, object_key) VALUES ('{tenant}', '{c.r.result_set}', 0, 0, 0, "
        f"2048, 2048, {len(CELLS)}, {4 * len(CELLS)}, '{key}');",
    )
    data = chunk_bytes(CELLS, PROBS, CLASSES)
    put_chunk(key, data)
    return tenant, MemoryStore({key: data})


def collected(
    database: str, tenant: uuid.UUID, store: MemoryStore, root: Path, encoder: FakeEncoder
) -> tuple[list[ReviewedNucleusRow], int]:
    async def go() -> tuple[list[ReviewedNucleusRow], int]:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant)) as connection:
                rows = await reviewed_nuclei(connection, store, tenant)
        finally:
            await engine.dispose()

        async def source_of(slide: str) -> SlideSource:
            return SlideSource(Reader(), 1024, 1024)

        found = await pool_reviewed(
            FeatureStore(root),
            tenant,
            TYPER,
            BASE,
            nuclei_of(described(rows)),
            source_of,
            encoder,
            CLASSES,
        )
        return rows, found.pooled

    return asyncio.run(go())


def test_a_closed_geojson_ring_loses_its_closing_point() -> None:
    assert flat_ring({"type": "Polygon", "coordinates": [[[0, 0], [4, 0], [4, 4], [0, 0]]]}) == (
        0.0,
        0.0,
        4.0,
        0.0,
        4.0,
        4.0,
    )
    assert flat_ring({"type": "Point", "coordinates": [1, 2]}) == ()
    assert flat_ring(None) == ()


@pytest.mark.db
@pytest.mark.usefixtures("storage")
def test_review_decisions_become_pooled_features_and_a_reshape_is_pooled_again(
    api: ApiAs, database: str, tmp_path: Path
) -> None:
    c = called(api, database)
    tenant, store = with_cells(database, c)
    agreed = decide(api, c, "C1", {"value": "agree", "ai_class_id": c.tumor, "ai_score": 200})
    assert agreed.status_code == 200, agreed.text
    retyped = {"value": "disagree", "reasons": ["wrong_class"], "reason_class_id": str(c.stroma)}
    assert decide(api, c, "C2", retyped).status_code == 200
    assert decide(api, c, "C3", {"value": "disagree", "reasons": ["not_a_cell"]}).status_code == 200
    encoder = FakeEncoder()

    rows, pooled = collected(database, tenant, store, tmp_path, encoder)
    by_number = {row.number: row for row in rows}
    assert set(by_number) == {1, 2, 3}
    assert by_number[1].final_class == c.tumor
    assert by_number[2].final_class == str(c.stroma)
    assert by_number[3].rejected
    assert by_number[1].probabilities == pytest.approx((230 / 255, 25 / 255))
    assert by_number[1].outline == (99.0, 99.0, 101.0, 99.0, 101.0, 101.0, 99.0, 101.0)
    assert pooled == 2
    features = FeatureStore(tmp_path)
    stored = features.load(tenant, TYPER, BASE, str(c.r.slide))
    assert stored is not None
    assert len(stored.keys) == 2
    assert stored.starts[1][0] == pytest.approx(np.log([230 / 255, 25 / 255]))

    assert collected(database, tenant, store, tmp_path, encoder)[1] == 0

    reshaped = edit(api, c.r, "first", "C2", {"geometry": circle(160, 130, 14)})
    assert reshaped.status_code == 200, reshaped.text
    rows, pooled = collected(database, tenant, store, tmp_path, encoder)
    assert pooled == 1
    assert next(row for row in rows if row.number == 2).reshaped
    after = features.load(tenant, TYPER, BASE, str(c.r.slide))
    assert after is not None
    assert after.keys == stored.keys
    row = stored.keys.index(f"{c.r.task}:cell:2")
    assert not np.allclose(after.features[row], stored.features[row])
    assert np.array_equal(after.features[1 - row], stored.features[1 - row])
