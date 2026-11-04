import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_result_sets import DRAFT, Lab, in_tenant, lab, query_in

from parfocal_api.result_sets import RegionRow, add_regions, finish
from parfocal_api.tables import ResultObjectKind

pytestmark = pytest.mark.db

LARGE = "POLYGON((100 200,4100 200,4100 2200,100 2200,100 200))"
SMALL = "POLYGON((5000 6000,5300 6000,5300 6100,5000 6100,5000 6000))"


def areas_of(lb: Lab) -> str:
    return f"/api/slides/{lb.slide}/areas"


def import_regions(api: ApiAs, database: str, lb: Lab, regions: list[RegionRow]) -> str:
    set_id = api(lb.people["owner"]).post(lb.sets, json=DRAFT).json()["id"]

    async def work(connection: Any) -> None:
        await add_regions(connection, uuid.UUID(set_id), regions)
        await finish(connection, uuid.UUID(set_id))

    in_tenant(database, lb.tenant_id, work)
    return set_id


def bounds(body: Any) -> list[tuple[Any, ...]]:
    return [(a["object"], a["x"], a["y"], a["width"], a["height"], a["size_mm"]) for a in body]


def test_a_slide_serves_the_bounds_and_sizes_of_its_latest_regions(
    api: ApiAs, database: str
) -> None:
    lb = lab(database)
    query_in(database, lb.tenant_id, f"UPDATE slides SET mpp_x = 0.5 WHERE id = '{lb.slide}'")
    client = api(lb.people["viewer"])
    assert client.get(areas_of(lb)).json() == []
    import_regions(api, database, lb, [RegionRow(ResultObjectKind.REGION, 1, SMALL, 0, 200)])
    latest = import_regions(
        api,
        database,
        lb,
        [
            RegionRow(ResultObjectKind.REGION, 1, LARGE, 0, 230),
            RegionRow(ResultObjectKind.REGION, 2, SMALL, 0, 120),
            RegionRow(ResultObjectKind.ZONE, 1, SMALL),
        ],
    )
    response = client.get(areas_of(lb))
    assert response.status_code == 200, response.text
    assert bounds(response.json()) == [
        ("T1", 100, 200, 4000, 2000, 2.0),
        ("T2", 5000, 6000, 300, 100, 0.15),
    ]
    assert {a["result_set_id"] for a in response.json()} == {latest}
    api(lb.people["owner"]).delete(f"/api/result-sets/{latest}")
    assert [a["object"] for a in client.get(areas_of(lb)).json()] == ["T1"]


def test_a_slide_without_a_scale_has_bounds_but_no_sizes(api: ApiAs, database: str) -> None:
    lb = lab(database)
    query_in(database, lb.tenant_id, f"UPDATE slides SET mpp_x = NULL WHERE id = '{lb.slide}'")
    import_regions(api, database, lb, [RegionRow(ResultObjectKind.REGION, 1, LARGE, 0, 230)])
    assert bounds(api(lb.people["owner"]).get(areas_of(lb)).json()) == [
        ("T1", 100, 200, 4000, 2000, None)
    ]


def test_another_workspace_and_strangers_get_no_areas(api: ApiAs, database: str) -> None:
    lb = lab(database)
    other = lab(database)
    import_regions(api, database, lb, [RegionRow(ResultObjectKind.REGION, 1, LARGE, 0, 230)])
    assert api(other.people["owner"]).get(areas_of(lb)).status_code == 404
    assert api(lb.people["outsider"]).get(areas_of(lb)).status_code == 404
