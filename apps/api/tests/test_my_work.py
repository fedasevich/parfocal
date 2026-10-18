import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_review_tasks import Study, draft, study
from workspace_support import owner

from parfocal_api.principals import ServicePrincipal

pytestmark = pytest.mark.db


def task(api: ApiAs, s: Study, **changes: Any) -> dict[str, Any]:
    response = api(s.people["owner"]).post(s.tasks, json=draft(s, **changes))
    assert response.status_code == 201, response.text
    return response.json()


def submit(api: ApiAs, s: Study, who: str, task_id: str, slide: uuid.UUID) -> None:
    response = api(s.people[who]).post(f"/api/review-tasks/{task_id}/slides/{slide}/submit")
    assert response.status_code == 200, response.text


def seed_verdict(database: str, s: Study, task_id: str, who: str, value: str) -> None:
    reason = "'not_a_cell'" if value == "disagree" else "NULL"
    owner(
        database,
        "INSERT INTO verdicts (tenant_id, project_id, task_id, slide_id, user_id, kind, number, "
        f"value, reason) VALUES ('{s.tenant_id}', '{s.project}', '{task_id}', '{s.slides[0]}', "
        f"'{s.people[who].user_id}', 'cell', 1, '{value}', {reason})",
    )


def test_to_review_lists_my_tasks_with_progress_and_the_next_slide(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    pair = [s.user("first"), s.user("second")]
    started = task(api, s, name="Started", case_ids=[], reviewer_ids=pair, due_on="2026-12-01")
    fresh = task(api, s, name="Fresh", split="even", reviewer_ids=pair, due_on="2026-11-01")
    submit(api, s, "first", started["id"], s.slides[0])
    seed_verdict(database, s, started["id"], "first", "agree")
    mine = api(s.people["first"]).get("/api/me/review-tasks").json()
    assert [(t["name"], t["status"]) for t in mine] == [
        ("Started", "in-review"),
        ("Fresh", "not-started"),
    ]
    first = mine[0]
    assert (first["slides_submitted"], first["slides_assigned"], first["verdicts"]) == (1, 2, 1)
    assert first["next_slide_id"] == str(s.slides[1])
    assert first["project"]["code"] == "P01"
    assert mine[1]["next_slide_id"] == str(s.slides[0])
    assert (mine[1]["slides_assigned"], mine[1]["due_on"]) == (2, "2026-11-01")
    assert [t["name"] for t in api(s.people["third"]).get("/api/me/review-tasks").json()] == []
    assert fresh["code"] == "RT-2"


def test_assigned_by_me_shows_each_reviewer_and_the_task_status(api: ApiAs, database: str) -> None:
    s = study(database)
    pair = [s.user("first"), s.user("second")]
    made = task(api, s, slide_ids=[str(s.slides[0])], case_ids=[], reviewer_ids=pair)

    def status() -> tuple[str, int, list[tuple[int, int, str]]]:
        (item,) = api(s.people["owner"]).get("/api/me/assigned-tasks").json()
        people = sorted(
            (r["slides_submitted"], r["slides_assigned"], r["state"]) for r in item["reviewers"]
        )
        return item["status"], item["open_disagreements"], people

    assert status() == ("not-started", 0, [(0, 1, "not-started"), (0, 1, "not-started")])
    submit(api, s, "first", made["id"], s.slides[0])
    assert status() == ("in-review", 0, [(0, 1, "not-started"), (1, 1, "submitted")])
    submit(api, s, "second", made["id"], s.slides[0])
    assert status()[:2] == ("ready-to-sign-off", 0)
    seed_verdict(database, s, made["id"], "first", "agree")
    seed_verdict(database, s, made["id"], "second", "disagree")
    assert status()[:2] == ("disagreements", 1)
    owner(database, f"DELETE FROM verdicts WHERE task_id = '{made['id']}'")
    assert (
        api(s.people["owner"]).post(f"/api/review-tasks/{made['id']}/sign-off").status_code == 200
    )
    assert status()[0] == "signed-off"
    assert api(s.people["first"]).get("/api/me/assigned-tasks").json() == []
    statuses = [t["status"] for t in api(s.people["first"]).get("/api/me/review-tasks").json()]
    assert statuses == ["signed-off"]


def slide_ids(api: ApiAs, s: Study, who: str, **params: Any) -> list[str]:
    response = api(s.people[who]).get("/api/me/slides", params=params)
    assert response.status_code == 200, response.text
    return [row["id"] for row in response.json()["slides"]]


def test_all_slides_filters_by_project_set_reviewer_status_and_label(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    newest_first = [str(slide) for slide in reversed(s.slides)]
    assert slide_ids(api, s, "owner") == newest_first
    made = task(api, s, slide_ids=[str(s.slides[0])], case_ids=[], reviewer_ids=[s.user("first")])
    submit(api, s, "first", made["id"], s.slides[0])
    assert slide_ids(api, s, "owner", status="submitted") == [str(s.slides[0])]
    assert slide_ids(api, s, "owner", status="ready") == newest_first[:3]
    assert slide_ids(api, s, "owner", result_set="other MODEL") == [
        str(s.slides[1]),
        str(s.slides[0]),
    ]
    assert slide_ids(api, s, "owner", reviewer_id=s.user("first")) == [str(s.slides[0])]
    assert slide_ids(api, s, "owner", q="loose") == [str(s.slides[1]), str(s.slides[0])]
    assert slide_ids(api, s, "owner", q="%") == []
    assert slide_ids(api, s, "owner", project_id=str(uuid.uuid4())) == []
    row = api(s.people["owner"]).get("/api/me/slides", params={"status": "submitted"}).json()
    (only,) = row["slides"]
    assert [(r["task_code"], r["state"]) for r in only["reviews"]] == [("RT-1", "submitted")]
    assert {item["name"] for item in only["result_sets"]} == {"HoVer-NeXt", "Other model"}
    assert only["case_label"] is None
    assert slide_ids(api, s, "first") == [str(s.slides[0])]
    assert slide_ids(api, s, "third") == []


def test_all_slides_pages_with_a_cursor(api: ApiAs, database: str) -> None:
    s = study(database)
    client = api(s.people["owner"])
    first = client.get("/api/me/slides", params={"limit": 3}).json()
    assert len(first["slides"]) == 3
    assert first["next_cursor"]
    second = client.get(
        "/api/me/slides", params={"limit": 3, "cursor": first["next_cursor"]}
    ).json()
    assert [row["id"] for row in second["slides"]] == [str(s.slides[0])]
    assert second["next_cursor"] is None
    filtered = client.get("/api/me/slides", params={"limit": 1, "status": "ready"}).json()
    assert len(filtered["slides"]) == 1
    rest = client.get(
        "/api/me/slides", params={"limit": 5, "status": "ready", "cursor": filtered["next_cursor"]}
    ).json()
    assert len(rest["slides"]) == 3
    bad = client.get("/api/me/slides", params={"cursor": "not-a-cursor"})
    assert (bad.status_code, bad.json()["code"]) == (400, "bad-cursor")


def test_my_work_stays_in_its_workspace_and_is_for_members(api: ApiAs, database: str) -> None:
    s = study(database)
    task(api, s)
    other = study(database)
    stranger = api(other.people["owner"])
    assert stranger.get("/api/me/assigned-tasks").json() == []
    assert set(slide_ids(api, other, "owner")).isdisjoint({str(x) for x in s.slides})
    service = ServicePrincipal(uuid.uuid4(), s.tenant_id, frozenset({"see-slides"}))
    refused = api(service).get("/api/me/slides")
    assert (refused.status_code, refused.json()["code"]) == (403, "members-only")
