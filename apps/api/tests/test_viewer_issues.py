import uuid

import pytest
from db_support import ApiAs
from order_support import run_orders
from test_annotations import make_slide
from test_reviewed_layer import Review, review
from workspace_support import owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def test_a_withdrawn_task_reads_back_with_its_objects_and_takes_no_decisions(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    url = f"/api/review-tasks/{r.task}"
    assert api(r.people["first"]).post(f"{url}/withdraw").status_code in {403, 404}
    withdrawn = api(r.people["owner"]).post(f"{url}/withdraw")
    assert withdrawn.status_code == 200, withdrawn.text
    first_at = withdrawn.json()["withdrawn_at"]
    assert first_at is not None
    assert withdrawn.json()["withdrawn_by_user_id"] == str(r.people["owner"].user_id)
    again = api(r.people["owner"]).post(f"{url}/withdraw").json()
    assert again["withdrawn_at"] == first_at
    read = api(r.people["first"]).get(url)
    assert read.status_code == 200, read.text
    assert read.json()["withdrawn_at"] == first_at
    assert [slide["slide_id"] for slide in read.json()["slides"]] == [str(r.slide)]
    objects = api(r.people["first"]).get(f"{r.base}/objects")
    assert objects.status_code == 200, objects.text
    assert [item["object"] for item in objects.json()["objects"]] == ["T1", "T2"]
    refused = api(r.people["first"]).put(f"{r.base}/decisions/T1", json={"value": "agree"})
    assert (refused.status_code, refused.json()["code"]) == (409, "task-withdrawn")
    audited = owner(
        database,
        "SELECT count(*) FROM audit_events "
        f"WHERE action = 'task.withdrawn' AND target_id = '{r.task}'",
    )
    assert audited[0][0] == 1


def test_a_failed_high_power_read_flags_the_slide_once(api: ApiAs, database: str) -> None:
    r = review(api, database)
    listed = f"/api/me/slides?project_id={r.project}"
    before = api(r.people["first"]).get(listed).json()["slides"]
    assert [slide["high_power_unreadable"] for slide in before] == [False]
    for _ in range(2):
        told = api(r.people["first"]).post(f"/api/slides/{r.slide}/high-power-failure")
        assert told.status_code == 204, told.text
    after = api(r.people["first"]).get(listed).json()["slides"]
    assert [slide["high_power_unreadable"] for slide in after] == [True]
    notices = owner(database, f"SELECT notices FROM slides WHERE id = '{r.slide}'")
    assert notices[0][0] == ["high-power-unreadable"]


def test_a_slide_flagged_at_ingest_reads_as_unreadable(api: ApiAs, database: str) -> None:
    r = review(api, database)
    owner(
        database,
        f"UPDATE slides SET notices = '{{high-power-unreadable}}' WHERE id = '{r.slide}'",
    )
    listed = api(r.people["owner"]).get(f"/api/me/slides?project_id={r.project}").json()
    assert [slide["high_power_unreadable"] for slide in listed["slides"]] == [True]


def tenant_of(database: str, r: Review) -> uuid.UUID:
    rows = owner(database, f"SELECT tenant_id FROM projects WHERE id = '{r.project}'")
    return uuid.UUID(str(rows[0][0]))


def test_a_review_task_needs_a_result_set_on_every_slide(api: ApiAs, database: str) -> None:
    r = review(api, database)
    tenant = tenant_of(database, r)
    blank = make_slide(database, tenant, r.project)
    refused = api(r.people["owner"]).post(
        f"/api/projects/{r.project}/review-tasks",
        json={
            "name": "Mixed task",
            "slide_ids": [str(r.slide), str(blank)],
            "result_sets": [{"slide_id": str(r.slide), "result_set_id": str(r.result_set)}],
            "reviewer_ids": [str(r.people["first"].user_id)],
            "split": "everyone",
            "scope": {"kind": "all-regions"},
            "decision": {"style": "agree"},
        },
    )
    assert (refused.status_code, refused.json()["code"]) == (400, "no-result-set")


def test_a_slide_whose_ai_found_nothing_reads_back_with_no_objects(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    tenant = tenant_of(database, r)
    blank = make_slide(database, tenant, r.project)
    empty = owner(
        database,
        "INSERT INTO result_sets (tenant_id, project_id, slide_id, name, source, status, "
        "region_count, cell_count) "
        f"VALUES ('{tenant}', '{r.project}', '{blank}', 'HoVer-NeXt', 'import', 'ready', 0, 0) "
        "RETURNING id",
    )[0][0]
    made = api(r.people["owner"]).post(
        f"/api/projects/{r.project}/review-tasks",
        json={
            "name": "Mixed task",
            "slide_ids": [str(r.slide), str(blank)],
            "result_sets": [
                {"slide_id": str(r.slide), "result_set_id": str(r.result_set)},
                {"slide_id": str(blank), "result_set_id": str(empty)},
            ],
            "reviewer_ids": [str(r.people["first"].user_id)],
            "split": "everyone",
            "scope": {"kind": "all-regions"},
            "decision": {"style": "agree"},
        },
    )
    assert made.status_code == 201, made.text
    task = made.json()["id"]
    run_orders(database, tenant)
    read = api(r.people["first"]).get(f"/api/review-tasks/{task}")
    assert read.status_code == 200, read.text
    results = {slide["slide_id"]: slide["result_set_id"] for slide in read.json()["slides"]}
    assert results == {str(r.slide): str(r.result_set), str(blank): str(empty)}
    objects = api(r.people["first"]).get(f"/api/review-tasks/{task}/slides/{blank}/objects")
    assert objects.status_code == 200, objects.text
    assert objects.json()["objects"] == []
