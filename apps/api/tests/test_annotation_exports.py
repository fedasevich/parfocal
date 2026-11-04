import json
import uuid
from collections import Counter
from collections.abc import Iterator
from typing import Any

import pytest
from chunk_support import ring
from db_support import ApiAs, api_as
from storage_support import with_store
from test_result_sets import DRAFT, SQUARE, Lab, in_tenant, lab

from parfocal_api.result_sets import ChunkRow, RegionRow, add_chunks, add_regions, finish
from parfocal_api.tables import ResultObjectKind
from parfocal_common import flatgeobuf
from parfocal_common.chunk_store import Cell, build_cells, write_cells
from parfocal_common.result_store import ObjectResultStore

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

CELLS = 100_000
ROW = 400
SPACING = 10
REGIONS = 3
ZONES = 1
TOTAL = CELLS + REGIONS + ZONES + 1
ROI = {"type": "Polygon", "coordinates": [[[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]]]}


def many_cells() -> list[Cell]:
    return [
        Cell(
            index + 1,
            ring(5 + SPACING * (index % ROW), 5 + SPACING * (index // ROW)),
            index % 2,
            index % 256,
            region=1 if index < ROW else 0,
        )
        for index in range(CELLS)
    ]


def stored_run(api: ApiAs, database: str, lb: Lab) -> uuid.UUID:
    created = api(lb.people["owner"]).post(lb.sets, json=DRAFT)
    assert created.status_code == 201, created.text
    set_id = uuid.UUID(created.json()["id"])
    built = build_cells(lb.tenant_id, lb.slide, set_id, many_cells(), len(DRAFT["classes"]))
    assert len(built.entries) > 1
    entries = with_store(lambda store: write_cells(ObjectResultStore(store), built))

    async def rows(connection: Any) -> None:
        await add_regions(
            connection,
            set_id,
            [
                *(RegionRow(ResultObjectKind.REGION, n, SQUARE, 0, 200) for n in range(1, 4)),
                RegionRow(ResultObjectKind.ZONE, 1, SQUARE),
            ],
        )
        await add_chunks(connection, set_id, [ChunkRow.of(entry) for entry in entries])
        await finish(connection, set_id)

    in_tenant(database, lb.tenant_id, rows)
    added = api(lb.people["owner"]).post(
        f"/api/slides/{lb.slide}/annotations", json={"kind": "roi", "geometry": ROI}
    )
    assert added.status_code == 201, added.text
    return set_id


@pytest.fixture(scope="module")
def run(database: str, storage: object) -> Iterator[tuple[Lab, uuid.UUID]]:
    assert storage
    lb = lab(database)
    with api_as(database) as acting:
        yield lb, stored_run(acting, database, lb)


def export(api: ApiAs, lb: Lab, set_id: uuid.UUID | None, format: str) -> Any:
    query = f"?format={format}" + (f"&result_set_id={set_id}" if set_id else "")
    response = api(lb.people["owner"]).get(f"/api/slides/{lb.slide}/export{query}")
    assert response.status_code == 200, response.text[:500]
    assert response.headers["x-object-count"] == str(TOTAL if set_id else 1)
    return response


def test_geojson_holds_every_object_of_a_100k_run(api: ApiAs, run: tuple[Lab, uuid.UUID]) -> None:
    lb, set_id = run
    features = export(api, lb, set_id, "geojson").json()["features"]
    assert len(features) == TOTAL
    kinds = Counter(feature["properties"]["parfocal"]["kind"] for feature in features)
    assert kinds == {"cell": CELLS, "region": REGIONS, "zone": ZONES, "roi": 1}
    assert len({feature["id"] for feature in features}) == TOTAL
    cell = next(f for f in features if f["id"] == "T1.C1")
    assert cell["properties"]["objectType"] == "cell"
    assert cell["properties"]["classification"] == {"name": "tumor"}
    assert cell["properties"]["parfocal"]["origin"] == "ai"
    assert cell["geometry"]["coordinates"][0][0] == cell["geometry"]["coordinates"][0][-1]


def test_our_own_json_holds_every_object_of_a_100k_run(
    api: ApiAs, run: tuple[Lab, uuid.UUID]
) -> None:
    lb, set_id = run
    document = export(api, lb, set_id, "parfocal").json()
    assert document["format"] == "parfocal-results"
    assert document["model"] == {"name": DRAFT["name"]}
    assert len(document["objects"]) == TOTAL
    assert Counter(o["kind"] for o in document["objects"])["cell"] == CELLS


def test_flatgeobuf_holds_every_object_of_a_100k_run(
    api: ApiAs, run: tuple[Lab, uuid.UUID]
) -> None:
    lb, set_id = run
    response = export(api, lb, set_id, "flatgeobuf")
    assert response.headers["content-type"] == "application/flatgeobuf"
    head, *features = flatgeobuf.frames(response.content)
    assert flatgeobuf.feature_count(head) == TOTAL
    assert len(features) == TOTAL
    types = Counter(flatgeobuf.geometry_type_of(feature) for feature in features)
    assert types == {flatgeobuf.GeometryType.POLYGON: TOTAL}


def test_a_slide_without_a_run_exports_its_annotations(
    api: ApiAs, run: tuple[Lab, uuid.UUID]
) -> None:
    lb, _ = run
    features = export(api, lb, None, "geojson").json()["features"]
    assert [f["properties"]["parfocal"]["id"] for f in features] == ["R1"]
    assert json.dumps(features[0]["geometry"]) == json.dumps(ROI)


def test_a_run_from_another_slide_is_not_found(
    api: ApiAs, database: str, run: tuple[Lab, uuid.UUID]
) -> None:
    lb, set_id = run
    other = lab(database)
    response = api(other.people["owner"]).get(
        f"/api/slides/{other.slide}/export?result_set_id={set_id}"
    )
    assert response.status_code == 404
    elsewhere = api(lb.people["owner"]).get(
        f"/api/slides/{other.slide}/export?result_set_id={set_id}"
    )
    assert elsewhere.status_code == 404
