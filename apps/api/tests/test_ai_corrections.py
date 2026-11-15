from typing import Any

import pytest
from db_support import ApiAs
from test_model_runs import Lab, make_lab
from workspace_support import owner

pytestmark = pytest.mark.db


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database, admins=("owner",))


def copy(
    database: str,
    lab: Lab,
    number: int,
    *,
    origin: str,
    created: str,
    deleted: bool = False,
    kind: str = "cell",
) -> None:
    source = "NULL" if origin == "human" else str(number)
    removed = ", now()" if deleted else ", NULL"
    owner(
        database,
        "INSERT INTO annotations (tenant_id, project_id, slide_id, task_id, kind, number, "
        "geometry, origin, source_number, created_at, deleted_at) "
        f"VALUES ('{lab.tenant}', '{lab.project}', '{lab.slides[0]}', '{lab.task}', '{kind}', "
        f"{number}, 'SRID=0;POINT({number} 1)', '{origin}', {source}, '{created}'{removed})",
    )


def corrections(api: ApiAs, lab: Lab, query: str = "") -> Any:
    return api(lab.people["owner"]).get(f"/api/tenant/ai-corrections{query}")


def test_corrections_per_hundred_nuclei_are_counted_per_month(
    api: ApiAs, database: str, lab: Lab
) -> None:
    for number in range(1, 5):
        copy(database, lab, number, origin="ai-confirmed", created="2026-09-10T10:00:00Z")
    copy(database, lab, 5, origin="ai-edited", created="2026-09-11T10:00:00Z")
    copy(database, lab, 6, origin="ai-edited", created="2026-09-12T10:00:00Z", deleted=True)
    copy(database, lab, 7, origin="ai-confirmed", created="2026-10-02T10:00:00Z")
    copy(database, lab, 8, origin="ai-edited", created="2026-10-03T10:00:00Z")
    copy(database, lab, 9, origin="ai-confirmed", created="2026-10-03T10:00:00Z", deleted=True)
    copy(database, lab, 10, origin="human", created="2026-10-03T10:00:00Z")
    copy(database, lab, 11, origin="ai-edited", created="2026-10-04T10:00:00Z", kind="region")
    response = corrections(api, lab)
    assert response.status_code == 200, response.text
    body = response.json()
    assert [
        (item["month"][:7], item["nuclei_reviewed"], item["corrections"], item["per_hundred"])
        for item in body["months"]
    ] == [("2026-09", 6, 2, 33.33), ("2026-10", 2, 1, 50.0)]
    assert (body["nuclei_reviewed"], body["corrections"], body["per_hundred"]) == (8, 3, 37.5)


def test_the_corrections_range_limits_the_months(api: ApiAs, database: str, lab: Lab) -> None:
    copy(database, lab, 1, origin="ai-edited", created="2026-08-10T10:00:00Z")
    copy(database, lab, 2, origin="ai-confirmed", created="2026-09-10T10:00:00Z")
    body = corrections(api, lab, "?since=2026-09-01T00:00:00Z").json()
    assert [item["month"][:7] for item in body["months"]] == ["2026-09"]
    assert body["per_hundred"] == 0.0


def test_an_empty_range_is_refused_and_no_reviews_means_zero(api: ApiAs, lab: Lab) -> None:
    empty = corrections(api, lab).json()
    assert (empty["months"], empty["per_hundred"]) == ([], 0.0)
    refused = corrections(api, lab, "?since=2026-10-01T00:00:00Z&until=2026-09-01T00:00:00Z")
    assert (refused.status_code, refused.json()["code"]) == (400, "corrections-range-invalid")
