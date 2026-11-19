import pytest
from db_support import ApiAs
from test_reviewed_layer import review
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
