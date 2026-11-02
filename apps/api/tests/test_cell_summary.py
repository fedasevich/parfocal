import uuid

import numpy as np
import pytest
from db_support import ApiAs
from storage_support import with_store
from test_result_chunks import stored_set
from test_result_sets import DRAFT, lab
from workspace_support import owner

from parfocal_common.chunk_store import summary_of
from parfocal_common.result_store import ObjectResultStore
from parfocal_ingest.chunk_builder import CellTable, build_table, plan_chunks

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

CAMELYON_CELLS = 1_607_244
BUDGET_CLASSES = 5
BUDGET_BYTES = 25_000_000


def path_of(set_id: uuid.UUID) -> str:
    return f"/api/result-sets/{set_id}/cell-summary"


def jittered_table(count: int, classes: int) -> CellTable:
    rng = np.random.default_rng(7)
    side = int(np.ceil(np.sqrt(count)))
    number = np.arange(count)
    centre_x = (number % side) * 30.0 + rng.uniform(-8, 8, count)
    centre_y = (number // side) * 30.0 + rng.uniform(-8, 8, count)
    radius = rng.uniform(4, 9, count)
    corners = np.empty((count, 4, 2), np.float32)
    corners[:, 0] = np.column_stack((centre_x - radius, centre_y - radius))
    corners[:, 1] = np.column_stack((centre_x + radius, centre_y - radius))
    corners[:, 2] = np.column_stack((centre_x + radius, centre_y + radius))
    corners[:, 3] = np.column_stack((centre_x - radius, centre_y + radius))
    return CellTable(
        numbers=number + 1,
        points=corners.reshape(-1),
        offsets=np.arange(0, 4 * count + 1, 4),
        class_index=rng.integers(0, classes, count).astype(np.uint8),
        score=rng.integers(0, 256, count).astype(np.uint8),
        region=np.zeros(count, np.int64),
        probs=np.round(rng.dirichlet(np.ones(classes), count) * 255).astype(np.uint8),
    )


def test_the_summary_is_served_as_stored_and_gzip_encoded(api: ApiAs, database: str) -> None:
    lb = lab(database)
    set_id, built = stored_set(api, database, lb)
    response = api(lb.people["viewer"]).get(path_of(set_id))
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/vnd.parfocal.cell-summary"
    assert response.headers["content-encoding"] == "gzip"
    assert response.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert int(response.headers["content-length"]) == len(built.summary.data)
    summary = summary_of(response.content, built.prefix)
    assert list(summary.numbers()) == [11, 12, 13, 14, 15]
    assert summary.entries == built.entries


def test_a_set_without_cells_or_still_importing_has_no_summary(api: ApiAs, database: str) -> None:
    lb = lab(database)
    client = api(lb.people["owner"])
    importing = client.post(lb.sets, json=DRAFT).json()["id"]
    refused = client.get(path_of(uuid.UUID(importing)))
    assert (refused.status_code, refused.json()["code"]) == (404, "no-cell-summary")
    owner(database, f"UPDATE result_sets SET status = 'ready' WHERE id = '{importing}'")
    empty = client.get(path_of(uuid.UUID(importing)))
    assert (empty.status_code, empty.json()["code"]) == (404, "no-cell-summary")


def test_only_readers_of_the_slide_fetch_the_summary(api: ApiAs, database: str) -> None:
    lb = lab(database)
    set_id, _ = stored_set(api, database, lb)
    for label in ("reviewer", "outsider", "admin"):
        response = api(lb.people[label]).get(path_of(set_id))
        assert response.status_code == 404, label


def test_the_summary_of_1_6_million_cells_with_probabilities_fits_25_mb(
    api: ApiAs, database: str
) -> None:
    lb = lab(database)
    client = api(lb.people["owner"])
    set_id = uuid.UUID(client.post(lb.sets, json=DRAFT).json()["id"])
    table = jittered_table(CAMELYON_CELLS, BUDGET_CLASSES)
    plan = plan_chunks(lb.tenant_id, lb.slide, set_id, table, BUDGET_CLASSES)
    summary = build_table(table, plan).summary
    with_store(lambda store: ObjectResultStore(store).put(summary.key, summary.data))
    owner(
        database,
        f"UPDATE result_sets SET status = 'ready', cell_count = {CAMELYON_CELLS} "
        f"WHERE id = '{set_id}'",
    )
    response = client.get(path_of(set_id))
    assert response.status_code == 200, response.text
    sent = int(response.headers["content-length"])
    assert sent < BUDGET_BYTES, sent
    served = summary_of(response.content, plan.prefix)
    assert len(served) == CAMELYON_CELLS
    assert served.header["classes"] == BUDGET_CLASSES
