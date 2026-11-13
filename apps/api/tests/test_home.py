import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_my_work import submit, task
from test_review_tasks import Study, study
from workspace_support import owner

pytestmark = pytest.mark.db


def home(api: ApiAs, s: Study, who: str) -> dict[str, Any]:
    response = api(s.people[who]).get("/api/me/home")
    assert response.status_code == 200, response.text
    return response.json()


def judge(
    database: str,
    s: Study,
    task_id: str,
    who: str,
    slide: uuid.UUID,
    number: int,
    value: str,
    ago: str = "0 seconds",
) -> None:
    reason = "'{not_class}'" if value == "disagree" else "'{}'"
    owner(
        database,
        "INSERT INTO review_decisions (tenant_id, project_id, task_id, slide_id, user_id, "
        "kind, number, "
        f"value, style, answer, reasons, updated_at) VALUES ('{s.tenant_id}', '{s.project}', "
        f"'{task_id}', '{slide}', '{s.people[who].user_id}', 'region', {number}, '{value}', "
        f"'agree', '{value}', {reason}, "
        f"now() - interval '{ago}')",
    )


def where(target: dict[str, Any] | None) -> tuple[Any, ...] | None:
    if target is None:
        return None
    return (target["slide_label"], target["position"], target["object_id"])


def test_resume_follows_my_newest_work_on_a_slide_i_have_not_submitted(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    round_one = task(api, s, name="Round 1", case_ids=[], reviewer_ids=[s.user("first")])
    fresh = home(api, s, "first")["resume"]
    assert where(fresh) == ("loose-0", 1, None)
    assert (fresh["task_name"], fresh["task_code"], fresh["slides_assigned"]) == (
        "Round 1",
        "RT-1",
        2,
    )
    assert (fresh["project"]["code"], fresh["camera"], fresh["due_on"]) == (
        "P01",
        None,
        "2026-11-30",
    )
    judge(database, s, round_one["id"], "first", s.slides[1], 2, "agree", "1 hour")
    owner(
        database,
        "INSERT INTO review_edits (tenant_id, project_id, task_id, slide_id, user_id, kind, "
        f"number, deleted, updated_at) VALUES ('{s.tenant_id}', '{s.project}', "
        f"'{round_one['id']}', '{s.slides[0]}', '{s.people['first'].user_id}', 'region', 1, "
        "true, now() - interval '2 hours')",
    )
    resumed = home(api, s, "first")["resume"]
    assert where(resumed) == ("loose-1", 2, "T2")
    assert resumed["decisions_on_slide"] == 1
    owner(
        database,
        "INSERT INTO annotations (tenant_id, project_id, slide_id, task_id, kind, number, "
        f"geometry, created_by_user_id) VALUES ('{s.tenant_id}', '{s.project}', '{s.slides[0]}', "
        f"'{round_one['id']}', 'cell', 5, 'SRID=0;POINT(5 5)', '{s.people['first'].user_id}')",
    )
    assert where(home(api, s, "first")["resume"]) == ("loose-0", 1, "C5+")
    submit(api, s, "first", round_one["id"], s.slides[0])
    assert where(home(api, s, "first")["resume"]) == ("loose-1", 2, "T2")
    submit(api, s, "first", round_one["id"], s.slides[1])
    assert home(api, s, "first")["resume"] is None
    assert home(api, s, "outsider")["resume"] is None


def test_home_lists_open_tasks_by_due_date_and_the_week_in_numbers(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    me = [s.user("first")]
    later = task(api, s, name="Later", case_ids=[], reviewer_ids=me, due_on="2026-12-15")
    task(api, s, name="Undated", case_ids=[], reviewer_ids=me, due_on=None)
    task(api, s, name="Soon", case_ids=[], reviewer_ids=me, due_on="2026-11-01")
    done = task(api, s, name="Done", slide_ids=[str(s.slides[0])], case_ids=[], reviewer_ids=me)
    submit(api, s, "first", done["id"], s.slides[0])
    for number, value in ((1, "agree"), (2, "agree"), (3, "disagree")):
        judge(database, s, later["id"], "first", s.slides[0], number, value)
    judge(database, s, later["id"], "first", s.slides[1], 1, "agree", "8 days")
    submit(api, s, "first", later["id"], s.slides[0])
    mine = home(api, s, "first")
    assert [entry["name"] for entry in mine["tasks"]] == ["Soon", "Later", "Undated"]
    assert {entry["created_by_user_id"] for entry in mine["tasks"]} == {s.user("owner")}
    week = mine["week"]
    assert (week["objects_checked"], week["agreed"], week["open_disagreements"]) == (3, 2, None)
    assert week["agree_share"] == pytest.approx(2 / 3)
    queued = sum(
        entry["decision"] is None
        for task_id in (later["id"], done["id"])
        for entry in api(s.people["owner"]).get(f"/api/review-tasks/{task_id}/disagreements").json()
    )
    assert queued > 0
    assert home(api, s, "owner")["week"]["open_disagreements"] == queued
    assert home(api, s, "owner")["week"]["objects_checked"] == 0


def test_project_cards_show_what_each_member_may_read(api: ApiAs, database: str) -> None:
    s = study(database)
    owner(
        database,
        "INSERT INTO slides (tenant_id, project_id, label) "
        f"VALUES ('{s.tenant_id}', '{s.project}', 'no-results')",
    )
    round_one = task(
        api,
        s,
        name="Round 1",
        slide_ids=[str(s.slides[1])],
        case_ids=[],
        reviewer_ids=[s.user("first")],
    )
    submit(api, s, "first", round_one["id"], s.slides[1])
    as_owner = home(api, s, "owner")
    [card] = as_owner["projects"]
    assert (card["code"], card["my_role"], card["members"]) == ("P01", "owner", 5)
    assert (card["slides"], card["result_sets"], card["reviewed_slides"]) == (5, 6, 1)
    assert [(entry["label"], entry["reviewed"]) for entry in card["strip"]] == [
        ("loose-0", False),
        ("loose-1", True),
        ("A1", False),
        ("A2", False),
    ]
    assert as_owner["slides_without_results"] == 1
    [seen] = home(api, s, "first")["projects"]
    assert (seen["my_role"], seen["slides"], seen["result_sets"], seen["reviewed_slides"]) == (
        "reviewer",
        1,
        2,
        1,
    )
    assert [entry["label"] for entry in seen["strip"]] == ["loose-1"]
    assert home(api, s, "first")["slides_without_results"] == 0
    assert home(api, s, "outsider")["projects"] == []


def test_every_member_gets_a_home_with_the_announcements(api: ApiAs, database: str) -> None:
    s = study(database)
    posted = api(s.people["admin"]).post(
        "/api/announcements", json={"kind": "model", "text": "CellViT is now one of the models"}
    )
    assert posted.status_code == 201, posted.text
    as_admin = home(api, s, "admin")
    assert (as_admin["tasks"], as_admin["projects"], as_admin["resume"]) == ([], [], None)
    assert as_admin["week"]["objects_checked"] == 0
    for who in ("admin", "first", "owner"):
        assert [entry["text"] for entry in home(api, s, who)["announcements"]] == [
            "CellViT is now one of the models"
        ]


def put_resume(api: ApiAs, s: Study, who: str, **body: Any) -> Any:
    return api(s.people[who]).put("/api/me/resume", json=body)


def test_a_stored_resume_state_wins_while_it_is_newer_than_my_review_activity(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    round_one = task(api, s, name="Round 1", case_ids=[], reviewer_ids=[s.user("first")])
    judge(database, s, round_one["id"], "first", s.slides[0], 2, "agree", "1 hour")
    stored = put_resume(
        api,
        s,
        "first",
        task_id=round_one["id"],
        slide_id=str(s.slides[1]),
        mode="viewer",
        object_id="T3",
        camera={"x": 1200.5, "y": 800, "z": 3.25},
    )
    assert stored.status_code == 200, stored.text
    assert (stored.json()["mode"], stored.json()["object_id"]) == ("viewer", "T3")
    resumed = home(api, s, "first")["resume"]
    assert where(resumed) == ("loose-1", 2, "T3")
    assert resumed["mode"] == "viewer"
    assert resumed["camera"] == {"x": 1200.5, "y": 800, "z": 3.25}
    put_resume(api, s, "first", task_id=round_one["id"], slide_id=str(s.slides[1]), mode="guided")
    moved = home(api, s, "first")["resume"]
    assert (where(moved), moved["mode"], moved["camera"]) == (("loose-1", 2, None), "guided", None)
    judge(database, s, round_one["id"], "first", s.slides[0], 4, "agree")
    later = home(api, s, "first")["resume"]
    assert (where(later), later["mode"], later["camera"]) == (("loose-0", 1, "T4"), "guided", None)
    put_resume(
        api,
        s,
        "first",
        task_id=round_one["id"],
        slide_id=str(s.slides[1]),
        object_id="T1",
        mode="guided",
    )
    assert where(home(api, s, "first")["resume"]) == ("loose-1", 2, "T1")
    submit(api, s, "first", round_one["id"], s.slides[1])
    assert where(home(api, s, "first")["resume"]) == ("loose-0", 1, "T4")


def test_resume_state_is_kept_only_for_my_own_task_slides(api: ApiAs, database: str) -> None:
    s = study(database)
    round_one = task(
        api,
        s,
        name="Round 1",
        slide_ids=[str(s.slides[0])],
        case_ids=[],
        reviewer_ids=[s.user("first")],
    )
    body = {"task_id": round_one["id"], "slide_id": str(s.slides[0]), "mode": "guided"}
    assert put_resume(api, s, "second", **body).status_code == 404
    assert put_resume(api, s, "outsider", **body).status_code == 404
    assert put_resume(api, s, "first", **{**body, "slide_id": str(s.slides[1])}).status_code == 404
    assert put_resume(api, s, "first", **{**body, "mode": "elsewhere"}).status_code == 422
    assert put_resume(api, s, "first", **body, camera={"x": 1, "y": 2}).status_code == 422
    assert put_resume(api, s, "first", **body, extra=True).status_code == 422
    assert put_resume(api, s, "first", **body).status_code == 200
    assert home(api, s, "second")["resume"] is None
