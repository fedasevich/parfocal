import uuid
from datetime import UTC, datetime
from typing import Any

import httpx2
import pytest
from chunk_support import ring
from db_support import ApiAs
from order_support import run_orders
from storage_support import TEST_STORAGE, with_store
from test_result_sets import DRAFT, Lab, in_tenant, lab
from workspace_support import owner

from parfocal_api.result_sets import ChunkRow, add_chunks, finish
from parfocal_common.chunk_store import (
    BuiltCells,
    Cell,
    CellSummary,
    ChunkEntry,
    build_cells,
    read_chunk,
    read_summary,
    write_cells,
)
from parfocal_common.object_store import ObjectStore, presign
from parfocal_common.result_store import ObjectResultStore

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

CELLS = [
    Cell(11, ring(100, 100), 0, 30, probs=[90, 165], alt_class=1),
    Cell(12, ring(3000, 100), 1, 20, probs=[40, 215]),
    Cell(13, ring(3000, 3000), 255, 10, flags=1, probs=[128, 127]),
    Cell(14, ring(100, 3000), 0, 200, probs=[250, 5], nucleus=ring(100, 3000)),
    Cell(15, ring(500, 500), 1, 50, probs=[200, 55]),
]


def stored_set(api: ApiAs, database: str, lb: Lab) -> tuple[uuid.UUID, BuiltCells]:
    created = api(lb.people["owner"]).post(lb.sets, json=DRAFT)
    assert created.status_code == 201, created.text
    set_id = uuid.UUID(created.json()["id"])
    built = build_cells(lb.tenant_id, lb.slide, set_id, CELLS, len(DRAFT["classes"]))
    entries = with_store(lambda store: write_cells(ObjectResultStore(store), built))

    async def rows(connection: Any) -> None:
        await add_chunks(connection, set_id, [ChunkRow.of(entry) for entry in entries])
        await finish(connection, set_id)

    in_tenant(database, lb.tenant_id, rows)
    return set_id, built


async def read_back(store: ObjectStore, built: BuiltCells) -> tuple[list[Cell], CellSummary]:
    results = ObjectResultStore(store)
    cells = [
        cell for entry in built.entries for cell in await read_chunk(results, entry.object_key)
    ]
    return cells, await read_summary(results, built.prefix)


def test_a_sets_chunks_are_written_to_storage_and_read_back(api: ApiAs, database: str) -> None:
    lb = lab(database)
    set_id, built = stored_set(api, database, lb)
    assert built.prefix == f"t/{lb.tenant_id}/s/{lb.slide}/results/{set_id}/"
    cells, summary = with_store(lambda store: read_back(store, built))
    assert sorted(cells, key=lambda cell: cell.number) == CELLS
    assert summary.entries == built.entries
    assert list(summary.numbers()) == [11, 12, 13, 14, 15]
    keys = with_store(lambda store: store.list_keys(built.prefix))
    assert sorted(keys) == sorted([*(e.object_key for e in built.entries), built.summary.key])
    first = built.entries[0].object_key
    size = with_store(lambda store: store.head_object(first))
    assert size == len(built.chunks[0].data)
    served = httpx2.get(presign(TEST_STORAGE, "GET", first, {}, 60, datetime.now(UTC)))
    assert served.headers["content-encoding"] == "gzip"
    ready = api(lb.people["owner"]).get(f"/api/result-sets/{set_id}").json()
    assert (ready["status"], ready["cell_count"]) == ("ready", 5)


def test_the_database_index_matches_the_summary_index(api: ApiAs, database: str) -> None:
    lb = lab(database)
    set_id, built = stored_set(api, database, lb)
    rows = owner(
        database,
        "SELECT chunk, x, y, width, height, cell_count, vertex_count, object_key "
        f"FROM result_chunks WHERE result_set_id = '{set_id}' ORDER BY chunk",
    )
    assert [tuple(row) for row in rows] == [
        tuple(vars(ChunkRow.of(entry)).values()) for entry in built.entries
    ]
    entries: list[ChunkEntry] = list(built.entries)
    assert [(e.x, e.y, e.cell_count) for e in entries] == [
        (0, 0, 2),
        (2048, 0, 1),
        (0, 2048, 1),
        (2048, 2048, 1),
    ]
    assert [e.class_counts for e in entries] == [(1, 1), (0, 1), (1, 0), (0, 0)]
    assert [e.unclassified for e in entries] == [0, 0, 0, 1]
    assert [e.unsure for e in entries] == [0, 0, 0, 1]


def test_a_cell_scope_task_orders_the_cells_read_from_storage(api: ApiAs, database: str) -> None:
    lb = lab(database)
    set_id, _ = stored_set(api, database, lb)
    task = api(lb.people["owner"]).post(
        f"/api/projects/{lb.project}/review-tasks",
        json={
            "name": "Cells from storage",
            "slide_ids": [str(lb.slide)],
            "result_sets": [{"slide_id": str(lb.slide), "result_set_id": str(set_id)}],
            "reviewer_ids": [str(lb.people["reviewer"].user_id)],
            "split": "everyone",
            "scope": {"kind": "cells-below-score", "score": 0.3},
        },
    )
    assert task.status_code == 201, task.text
    run_orders(database, lb.tenant_id)
    order = api(lb.people["reviewer"]).get(
        f"/api/review-tasks/{task.json()['id']}/slides/{lb.slide}/order"
    )
    assert order.status_code == 200, order.text
    assert [item["object"] for item in order.json()["objects"]] == ["C15", "C11", "C12", "C13"]
