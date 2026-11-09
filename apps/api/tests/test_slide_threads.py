from typing import Any

import pytest
from db_support import ApiAs
from test_annotations import make_slide
from test_blinding import Study, make_result_set, ok, study
from test_threads import POINT, audit_rows, code_of, thread_body
from workspace_support import make_case, owner

pytestmark = pytest.mark.db

PIN = {"kind": "point", "geometry": POINT}


def slide_base(s: Study) -> str:
    return f"/api/projects/{s.project}/slides/{s.slide}/threads"


def open_on_slide(api: ApiAs, s: Study, who: str, title: str, anchor: Any = None) -> Any:
    return api(s.people[who]).post(slide_base(s), json=thread_body(anchor or PIN, title))


def slide_titles(api: ApiAs, s: Study, who: str) -> list[str]:
    return [thread["title"] for thread in ok(api(s.people[who]).get(slide_base(s))).json()]


def test_a_thread_starts_on_a_slide_with_no_task_and_lives_apart_from_the_task(
    api: ApiAs, database: str
) -> None:
    s = study(api, database, blinded=False, hidden=False)
    made = ok(open_on_slide(api, s, "owner", "Slide question"))
    assert made.status_code == 201
    thread = made.json()
    assert thread["task_id"] is None
    assert thread["project_id"] == str(s.project)
    assert thread["slide_id"] == str(s.slide)
    on_task = ok(
        api(s.people["owner"]).post(
            slide_base(s), json={**thread_body(PIN, "Task question"), "task_id": str(s.task)}
        )
    ).json()
    assert on_task["task_id"] == str(s.task)
    assert slide_titles(api, s, "owner") == ["Slide question"]
    task_titles = [
        item["title"] for item in ok(api(s.people["owner"]).get(f"{s.base}/threads")).json()
    ]
    assert task_titles == ["Task question"]
    assert api(s.people["owner"]).get(f"{s.base}/threads/{thread['id']}").status_code == 404
    on_object = ok(open_on_slide(api, s, "first", "On T1", {"kind": "object", "object_id": "T1"}))
    assert on_object.json()["anchor"]["object_id"] == "T1"
    unknown = open_on_slide(api, s, "first", "On T9", {"kind": "object", "object_id": "T9"})
    assert unknown.status_code == 400
    assert code_of(unknown) == "bad-anchor"


def test_replies_resolve_move_and_delete_a_slide_thread(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    thread = ok(open_on_slide(api, s, "first", "Is this tumour?")).json()
    path = f"{slide_base(s)}/{thread['id']}"
    ok(api(s.people["owner"]).post(f"{path}/messages", json={"body": "Looks benign."}))
    assert ok(api(s.people["first"]).post(f"{path}/resolve")).json()["resolved_by"] == s.user(
        "first"
    )
    assert ok(api(s.people["owner"]).post(f"{path}/reopen")).json()["resolved_at"] is None
    target = {"type": "Point", "coordinates": [5.0, 6.0]}
    moved = ok(api(s.people["first"]).patch(f"{path}/anchor", json={"geometry": target})).json()
    assert moved["anchor"]["geometry"] == target
    assert [message["body"] for message in moved["messages"]] == [
        "Please look at the margin.",
        "Looks benign.",
    ]
    refused = api(s.people["second"]).delete(path)
    assert refused.status_code == 403
    assert code_of(refused) == "not-thread-author"
    assert code_of(api(s.people["first"]).delete(path)) == "thread-has-replies"
    assert api(s.people["first"]).delete(f"{path}?confirm=true").status_code == 204
    assert api(s.people["first"]).get(path).status_code == 404
    rows = audit_rows(database, thread["id"])
    assert [action for action, _ in rows] == [
        "thread.created",
        "thread.replied",
        "thread.resolved",
        "thread.reopened",
        "thread.moved",
        "thread.deleted",
    ]
    assert all(details["task_id"] is None for _, details in rows)
    assert all(details["slide_id"] == str(s.slide) for _, details in rows)
    assert "tumour" not in str(rows)
    assert "benign" not in str(rows)


def test_a_slide_thread_is_closed_to_outsiders_and_other_tenants(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    other = study(api, database, blinded=False, hidden=False)
    thread = ok(open_on_slide(api, s, "owner", "Owner asks")).json()
    path = f"{slide_base(s)}/{thread['id']}"
    for who in ("third", "admin"):
        assert api(s.people[who]).get(slide_base(s)).status_code == 404, who
        assert open_on_slide(api, s, who, "Nope").status_code == 404, who
    assert open_on_slide(api, s, "viewer", "Nope").status_code == 403
    assert api(s.people["viewer"]).get(path).status_code == 200
    assert api(other.people["owner"]).get(slide_base(s)).status_code == 404
    assert api(other.people["owner"]).get(path).status_code == 404
    assert (
        api(other.people["owner"]).post(f"{path}/messages", json={"body": "Hi"}).status_code == 404
    )
    assert api(other.people["owner"]).delete(f"{path}?confirm=true").status_code == 404
    wrong_project = f"/api/projects/{other.project}/slides/{s.slide}/threads"
    assert api(other.people["owner"]).get(wrong_project).status_code == 404
    elsewhere = api(s.people["owner"]).post(
        f"/api/projects/{other.project}/slides/{s.slide}/threads", json=thread_body(PIN)
    )
    assert elsewhere.status_code == 404
    count = owner(database, f"SELECT count(*) FROM threads WHERE slide_id = '{s.slide}'")
    assert count[0][0] == 1


def test_a_reader_with_an_open_first_read_sees_only_their_own_and_the_researchers(
    api: ApiAs, database: str
) -> None:
    s = study(api, database, blinded=False, hidden=True)
    researchers = ok(open_on_slide(api, s, "owner", "Owner asks")).json()
    ok(open_on_slide(api, s, "second", "Second asks"))
    ok(open_on_slide(api, s, "first", "First asks"))
    path = f"{slide_base(s)}/{researchers['id']}"
    ok(api(s.people["second"]).post(f"{path}/messages", json={"body": "Second answers"}))
    assert slide_titles(api, s, "first") == ["Owner asks", "First asks"]
    assert slide_titles(api, s, "viewer") == ["Owner asks", "Second asks", "First asks"]
    seen = ok(api(s.people["first"]).get(path)).json()
    assert [message["body"] for message in seen["messages"]] == ["Please look at the margin."]
    hidden = open_on_slide(api, s, "first", "On T1", {"kind": "object", "object_id": "T1"})
    assert hidden.status_code == 403
    assert code_of(hidden) == "ai-hidden"
    ok(open_on_slide(api, s, "owner", "On the AI region", {"kind": "object", "object_id": "T1"}))
    assert "On the AI region" not in slide_titles(api, s, "first")
    ok(api(s.people["first"]).post(f"{s.base}/first-read"))
    assert slide_titles(api, s, "first") == [
        "Owner asks",
        "Second asks",
        "First asks",
        "On the AI region",
    ]


def test_a_signed_off_task_does_not_stop_a_slide_thread(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    owner(database, f"UPDATE review_tasks SET signed_off_at = now() WHERE id = '{s.task}'")
    on_task = api(s.people["owner"]).post(
        slide_base(s), json={**thread_body(PIN), "task_id": str(s.task)}
    )
    assert on_task.status_code == 409
    thread = ok(open_on_slide(api, s, "first", "Still open")).json()
    ok(
        api(s.people["owner"]).post(
            f"{slide_base(s)}/{thread['id']}/messages", json={"body": "Still answers"}
        )
    )
    owner(database, f"UPDATE projects SET archived_at = now() WHERE id = '{s.project}'")
    assert open_on_slide(api, s, "first", "Archived").status_code == 409


def test_a_reply_on_a_slide_thread_carries_the_case_so_a_project_mute_catches_it(
    api: ApiAs, database: str
) -> None:
    s = study(api, database, blinded=False, hidden=False)
    case = make_case(database, s.people["owner"].tenant_id, s.project, "C-1")
    owner(database, f"UPDATE slides SET case_id = '{case}' WHERE id = '{s.slide}'")
    owner(
        database,
        "INSERT INTO notification_mutes (tenant_id, user_id, subject, subject_id) "
        f"SELECT tenant_id, '{s.user('owner')}', 'project', id FROM projects "
        f"WHERE id = '{s.project}'",
    )
    thread = ok(open_on_slide(api, s, "owner", "Owner asks")).json()
    path = f"{slide_base(s)}/{thread['id']}"
    ok(api(s.people["first"]).post(f"{path}/messages", json={"body": "First answers"}))
    rows = owner(
        database,
        "SELECT user_id, id, muted, project_id, task_id, case_id, payload FROM notifications "
        f"WHERE kind = 'reply' AND target_id = '{thread['id']}'",
    )
    assert [(str(row[0]), row[2], str(row[3]), row[4], str(row[5])) for row in rows] == [
        (s.user("owner"), True, str(s.project), None, str(case))
    ]
    assert "task_id" not in str(rows[0][6])
    target = ok(api(s.people["owner"]).get(f"/api/me/notifications/{rows[0][1]}/target")).json()
    assert target["kind"] == "thread"
    assert target["task_id"] is None
    assert target["slide_id"] == str(s.slide)
    assert target["thread_id"] == thread["id"]
    assert target["case_id"] == str(case)
    assert target["origin"]["route"] == "case"
    assert target["origin"]["case_id"] == str(case)
    assert target["origin"]["task_id"] is None


def test_a_taskless_object_anchor_keeps_the_result_set_it_names(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    tenant = s.people["owner"].tenant_id
    second = make_result_set(database, tenant, s.project, s.slide)
    on_t1 = {"kind": "object", "object_id": "T1"}
    unnamed = open_on_slide(api, s, "owner", "Which T1?", on_t1)
    assert unnamed.status_code == 400
    assert code_of(unnamed) == "bad-anchor"
    made = ok(open_on_slide(api, s, "owner", "Second T1", {**on_t1, "result_set_id": second}))
    assert made.json()["anchor"]["result_set_id"] == second
    first = ok(
        open_on_slide(api, s, "owner", "First T1", {**on_t1, "result_set_id": str(s.result_set)})
    )
    assert first.json()["anchor"]["result_set_id"] == str(s.result_set)
    listed = ok(api(s.people["owner"]).get(slide_base(s))).json()
    assert {item["title"]: item["anchor"]["result_set_id"] for item in listed} == {
        "Second T1": second,
        "First T1": str(s.result_set),
    }
    read = ok(api(s.people["owner"]).get(f"{slide_base(s)}/{made.json()['id']}")).json()
    assert read["anchor"]["result_set_id"] == second
    other_slide = make_slide(database, tenant, s.project)
    elsewhere = make_result_set(database, tenant, s.project, other_slide)
    wrong = open_on_slide(api, s, "owner", "Elsewhere", {**on_t1, "result_set_id": elsewhere})
    assert code_of(wrong) == "bad-anchor"
    missing = open_on_slide(
        api, s, "owner", "No T9", {"kind": "object", "object_id": "T9", "result_set_id": second}
    )
    assert code_of(missing) == "bad-anchor"
    on_task = ok(
        api(s.people["owner"]).post(
            slide_base(s), json={**thread_body(on_t1, "Task T1"), "task_id": str(s.task)}
        )
    ).json()
    assert on_task["anchor"]["result_set_id"] == str(s.result_set)
    crossed = api(s.people["owner"]).post(
        slide_base(s),
        json={
            **thread_body({**on_t1, "result_set_id": second}, "Crossed"),
            "task_id": str(s.task),
        },
    )
    assert code_of(crossed) == "bad-anchor"
    pinned = open_on_slide(api, s, "owner", "Pin", {**PIN, "result_set_id": second})
    assert pinned.status_code == 422
