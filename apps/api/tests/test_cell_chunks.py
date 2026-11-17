import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_result_chunks import stored_set
from test_result_sets import DRAFT, in_tenant, lab

from parfocal_api.result_sets import RegionRow, add_regions, finish
from parfocal_api.tables import ResultObjectKind
from parfocal_common.chunk_store import chunk_of

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def chunk_path(set_id: uuid.UUID, chunk: int) -> str:
    return f"/api/result-sets/{set_id}/cell-chunks/{chunk}"


def test_each_chunk_is_served_as_stored_and_gzip_encoded(api: ApiAs, database: str) -> None:
    lb = lab(database)
    set_id, built = stored_set(api, database, lb)
    client = api(lb.people["viewer"])
    for entry, stored in zip(built.entries, built.chunks, strict=True):
        response = client.get(chunk_path(set_id, entry.chunk))
        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "application/vnd.parfocal.cell-chunk"
        assert response.headers["content-encoding"] == "gzip"
        assert response.headers["cache-control"] == "private, max-age=31536000, immutable"
        assert int(response.headers["content-length"]) == len(stored.data)
        header, _ = chunk_of(response.content)
        assert header["count"] == entry.cell_count


def test_an_unknown_chunk_or_unready_set_has_no_chunk(api: ApiAs, database: str) -> None:
    lb = lab(database)
    set_id, built = stored_set(api, database, lb)
    client = api(lb.people["owner"])
    missing = client.get(chunk_path(set_id, len(built.entries) + 5))
    assert (missing.status_code, missing.json()["code"]) == (404, "no-cell-chunk")
    importing = uuid.UUID(client.post(lb.sets, json=DRAFT).json()["id"])
    refused = client.get(chunk_path(importing, 0))
    assert (refused.status_code, refused.json()["code"]) == (404, "no-cell-chunk")


def test_only_readers_of_the_slide_fetch_a_chunk(api: ApiAs, database: str) -> None:
    lb = lab(database)
    set_id, _ = stored_set(api, database, lb)
    for label in ("reviewer", "outsider", "admin"):
        assert api(lb.people[label]).get(chunk_path(set_id, 0)).status_code == 404, label


def square(left: int, top: int, side: int) -> str:
    right, bottom = left + side, top + side
    return f"POLYGON(({left} {top},{right} {top},{right} {bottom},{left} {bottom},{left} {top}))"


def region(number: int, wkt: str, position: int | None, score: int | None) -> RegionRow:
    return RegionRow(ResultObjectKind.REGION, number, wkt, class_position=position, score=score)


def region_set(api: ApiAs, database: str) -> tuple[Any, uuid.UUID]:
    lb = lab(database)
    set_id = uuid.UUID(api(lb.people["owner"]).post(lb.sets, json=DRAFT).json()["id"])
    rows = [
        region(1, square(0, 0, 100), 0, 255),
        region(2, square(5_000, 5_000, 200), 1, 51),
        region(3, square(9_000, 0, 50), None, None),
    ]

    async def write(connection: Any) -> None:
        await add_regions(connection, set_id, rows)
        await finish(connection, set_id)

    in_tenant(database, lb.tenant_id, write)
    return lb, set_id


def test_a_sets_regions_come_with_outlines_and_classes(api: ApiAs, database: str) -> None:
    lb, set_id = region_set(api, database)
    response = api(lb.people["viewer"]).get(f"/api/result-sets/{set_id}/regions")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["truncated"] is False
    by_number = {item["number"]: item for item in body["regions"]}
    assert sorted(by_number) == [1, 2, 3]
    assert by_number[1]["outline"] == [0, 0, 100, 0, 100, 100, 0, 100]
    assert (by_number[1]["class_index"], by_number[1]["score"]) == (0, 1.0)
    assert (by_number[2]["class_index"], by_number[2]["score"]) == (1, 0.2)
    assert (by_number[3]["class_index"], by_number[3]["score"]) == (None, None)
    assert by_number[1]["kind"] == "region"


def test_regions_are_paged_by_viewport_and_limit(api: ApiAs, database: str) -> None:
    lb, set_id = region_set(api, database)
    client = api(lb.people["viewer"])
    near = client.get(
        f"/api/result-sets/{set_id}/regions",
        params={"left": 4_900, "top": 4_900, "right": 6_000, "bottom": 6_000},
    ).json()
    assert [item["number"] for item in near["regions"]] == [2]
    first = client.get(f"/api/result-sets/{set_id}/regions", params={"limit": 2}).json()
    assert ([item["number"] for item in first["regions"]], first["truncated"]) == ([1, 2], True)


def test_the_set_names_its_classes(api: ApiAs, database: str) -> None:
    lb, set_id = region_set(api, database)
    detail = api(lb.people["viewer"]).get(f"/api/result-sets/{set_id}").json()
    assert [(item["source_name"], item["name"]) for item in detail["classes"]] == [
        ("tumor", "Tumor"),
        ("Lymphocyte", "Lymphocyte"),
    ]
