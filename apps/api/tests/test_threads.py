import json
import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_blinding import SQUARE, Study, ok, study
from workspace_support import owner

from parfocal_api.mentions import MAX_MENTIONS, token_for

pytestmark = pytest.mark.db

POINT = {"type": "Point", "coordinates": [40, 20]}
LINE = {"type": "LineString", "coordinates": [[0, 0], [30, 30]]}


def thread_body(anchor: dict[str, Any], title: str = "Is this tumour?") -> dict[str, Any]:
    return {"title": title, "body": "Please look at the margin.", "anchor": anchor}


def start(api: ApiAs, s: Study, who: str, anchor: dict[str, Any]) -> Any:
    return api(s.people[who]).post(f"{s.base}/threads", json=thread_body(anchor))


def titles(api: ApiAs, s: Study, who: str, query: str = "") -> list[str]:
    found = ok(api(s.people[who]).get(f"{s.base}/threads{query}")).json()
    return [thread["title"] for thread in found]


def code_of(response: Any) -> str:
    return response.json()["code"]


def test_threads_anchor_to_an_object_an_roi_a_point_or_a_shape(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    roi = ok(
        api(s.people["owner"]).post(
            f"/api/slides/{s.slide}/annotations", json={"kind": "roi", "geometry": SQUARE}
        )
    ).json()["code"]
    anchors = [
        {"kind": "object", "object_id": "t1", "offset": [3, 4]},
        {"kind": "roi", "object_id": roi},
        {"kind": "point", "geometry": POINT},
        {"kind": "shape", "geometry": LINE},
    ]
    made = [ok(start(api, s, "first", anchor)).json() for anchor in anchors]
    assert [thread["anchor"]["kind"] for thread in made] == ["object", "roi", "point", "shape"]
    assert made[0]["anchor"]["object_id"] == "T1"
    assert made[0]["anchor"]["offset"] == [3, 4]
    assert made[2]["anchor"]["geometry"] == POINT
    assert made[0]["messages"][0]["body"] == "Please look at the margin."
    assert made[0]["message_count"] == 1
    refused = {
        "unknown object": {"kind": "object", "object_id": "T9"},
        "not an id": {"kind": "object", "object_id": "X1"},
        "roi names a region": {"kind": "roi", "object_id": "T1"},
        "object names an roi": {"kind": "object", "object_id": roi},
        "missing roi": {"kind": "roi", "object_id": "R99"},
    }
    for name, anchor in refused.items():
        response = start(api, s, "first", anchor)
        assert response.status_code == 400, name
        assert code_of(response) == "bad-anchor", name
    malformed = [
        {"kind": "point", "geometry": SQUARE},
        {"kind": "shape", "geometry": POINT},
        {"kind": "point", "geometry": POINT, "offset": [1, 1]},
        {"kind": "object"},
        {"kind": "point", "object_id": "T1"},
    ]
    for anchor in malformed:
        assert start(api, s, "first", anchor).status_code == 422, anchor


def test_replies_resolve_reopen_and_delete_with_confirmation(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    first, owner_ = s.people["first"], s.people["owner"]
    thread = ok(start(api, s, "first", {"kind": "point", "geometry": POINT})).json()
    path = f"{s.base}/threads/{thread['id']}"
    reply = ok(api(owner_).post(f"{path}/messages", json={"body": "Looks benign."}))
    assert reply.status_code == 201
    resolved = ok(api(first).post(f"{path}/resolve")).json()
    assert resolved["resolved_by"] == s.user("first")
    assert titles(api, s, "first", "?resolved=false") == []
    assert titles(api, s, "first", "?resolved=true") == ["Is this tumour?"]
    assert ok(api(owner_).post(f"{path}/reopen")).json()["resolved_at"] is None
    detail = ok(api(first).get(path)).json()
    assert [message["body"] for message in detail["messages"]] == [
        "Please look at the margin.",
        "Looks benign.",
    ]
    refused = api(first).delete(path)
    assert refused.status_code == 409
    assert code_of(refused) == "thread-has-replies"
    assert api(first).delete(f"{path}?confirm=true").status_code == 204
    assert api(first).get(path).status_code == 404
    lone = ok(start(api, s, "first", {"kind": "point", "geometry": POINT})).json()
    assert api(first).delete(f"{s.base}/threads/{lone['id']}").status_code == 204


def test_a_pin_moves_and_keeps_its_replies_and_only_its_author_or_owner_moves_it(
    api: ApiAs, database: str
) -> None:
    s = study(api, database, blinded=False, hidden=False)
    thread = ok(start(api, s, "first", {"kind": "point", "geometry": POINT})).json()
    path = f"{s.base}/threads/{thread['id']}"
    ok(api(s.people["owner"]).post(f"{path}/messages", json={"body": "Looks benign."}))
    target = {"type": "Point", "coordinates": [55.5, 66.5]}
    moved = ok(api(s.people["first"]).patch(f"{path}/anchor", json={"geometry": target})).json()
    assert moved["anchor"]["kind"] == "point"
    assert moved["anchor"]["geometry"] == target
    assert len(moved["messages"]) == 2
    listed = ok(api(s.people["first"]).get(f"{s.base}/threads")).json()
    assert listed[0]["anchor"]["geometry"] == target
    refused = api(s.people["second"]).patch(f"{path}/anchor", json={"geometry": POINT})
    assert refused.status_code == 403
    assert code_of(refused) == "not-thread-author"
    assert (
        api(s.people["owner"]).patch(f"{path}/anchor", json={"geometry": POINT}).status_code == 200
    )
    assert (
        api(s.people["third"]).patch(f"{path}/anchor", json={"geometry": POINT}).status_code == 404
    )
    assert (
        api(s.people["first"])
        .patch(f"{path}/anchor", json={"geometry": {"type": "LineString", "coordinates": []}})
        .status_code
        == 422
    )
    assert [action for action, _ in audit_rows(database, thread["id"])].count("thread.moved") == 2


def test_only_a_pinned_thread_moves(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    thread = ok(start(api, s, "first", {"kind": "object", "object_id": "T2"})).json()
    refused = api(s.people["first"]).patch(
        f"{s.base}/threads/{thread['id']}/anchor", json={"geometry": POINT}
    )
    assert refused.status_code == 400
    assert code_of(refused) == "not-a-pin"


def test_who_may_comment_resolve_and_delete(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    point = {"kind": "point", "geometry": POINT}
    assert start(api, s, "viewer", point).status_code == 403
    assert start(api, s, "third", point).status_code == 404
    assert start(api, s, "admin", point).status_code == 404
    thread = ok(start(api, s, "owner", point)).json()
    path = f"{s.base}/threads/{thread['id']}"
    assert api(s.people["viewer"]).get(path).status_code == 200
    assert api(s.people["viewer"]).post(f"{path}/resolve").status_code == 403
    assert api(s.people["third"]).get(path).status_code == 404
    own = ok(start(api, s, "first", point)).json()
    refused = api(s.people["second"]).delete(f"{s.base}/threads/{thread['id']}")
    assert refused.status_code == 403
    assert code_of(refused) == "not-thread-author"
    assert api(s.people["owner"]).delete(f"{s.base}/threads/{own['id']}").status_code == 204


def test_a_blinded_reviewer_sees_only_their_own_threads_and_the_researchers(
    api: ApiAs, database: str
) -> None:
    s = study(api, database, blinded=True, hidden=False)
    point = {"kind": "point", "geometry": POINT}
    researchers = ok(
        api(s.people["owner"]).post(f"{s.base}/threads", json=thread_body(point, "Owner asks"))
    ).json()
    ok(api(s.people["second"]).post(f"{s.base}/threads", json=thread_body(point, "Second asks")))
    ok(api(s.people["first"]).post(f"{s.base}/threads", json=thread_body(point, "First asks")))
    path = f"{s.base}/threads/{researchers['id']}"
    ok(api(s.people["second"]).post(f"{path}/messages", json={"body": "Second answers"}))
    assert titles(api, s, "first") == ["Owner asks", "First asks"]
    assert titles(api, s, "second") == ["Owner asks", "Second asks", "First asks"]
    assert titles(api, s, "owner") == ["Owner asks", "Second asks", "First asks"]
    seen_by_first = ok(api(s.people["first"]).get(path)).json()
    assert [message["body"] for message in seen_by_first["messages"]] == [
        "Please look at the margin."
    ]
    assert len(ok(api(s.people["viewer"]).get(path)).json()["messages"]) == 2
    ok(api(s.people["first"]).post(f"{s.base}/submit"))
    assert titles(api, s, "first") == ["Owner asks", "Second asks", "First asks"]


def test_threads_on_hidden_ai_objects_wait_for_the_first_read(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=True)
    on_object = {"kind": "object", "object_id": "T1"}
    refused = start(api, s, "first", on_object)
    assert refused.status_code == 403
    assert code_of(refused) == "ai-hidden"
    ok(
        api(s.people["owner"]).post(
            f"{s.base}/threads", json=thread_body(on_object, "On the AI region")
        )
    )
    ok(
        api(s.people["owner"]).post(
            f"{s.base}/threads",
            json=thread_body({"kind": "point", "geometry": POINT}, "On a point"),
        )
    )
    assert titles(api, s, "first") == ["On a point"]
    ok(api(s.people["first"]).post(f"{s.base}/first-read"))
    assert titles(api, s, "first") == ["On the AI region", "On a point"]


def audit_rows(database: str, thread_id: str) -> list[tuple[str, dict[str, Any]]]:
    rows = owner(
        database,
        "SELECT action, details FROM audit_events "
        f"WHERE target_type = 'thread' AND target_id = '{thread_id}' ORDER BY seq",
    )
    return [
        (str(action), details if isinstance(details, dict) else json.loads(str(details)))
        for action, details in rows
    ]


def test_every_thread_change_is_audited_without_its_text(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    thread = ok(start(api, s, "first", {"kind": "object", "object_id": "T2"})).json()
    path = f"{s.base}/threads/{thread['id']}"
    ok(api(s.people["owner"]).post(f"{path}/messages", json={"body": "Secret words"}))
    ok(api(s.people["owner"]).post(f"{path}/resolve"))
    ok(api(s.people["owner"]).post(f"{path}/reopen"))
    assert api(s.people["owner"]).delete(f"{path}?confirm=true").status_code == 204
    rows = audit_rows(database, thread["id"])
    assert [action for action, _ in rows] == [
        "thread.created",
        "thread.replied",
        "thread.resolved",
        "thread.reopened",
        "thread.deleted",
    ]
    created = rows[0][1]
    assert created["anchor"] == "object"
    assert created["object"] == "T2"
    assert created["title_length"] == len("Is this tumour?")
    assert rows[-1][1]["replies"] == 1
    text = json.dumps([details for _, details in rows])
    assert "Secret" not in text
    assert "tumour" not in text
    assert "margin" not in text


def reply_rows(database: str, thread_id: str) -> list[tuple[object, ...]]:
    return owner(
        database,
        "SELECT user_id, id, muted, project_id, task_id FROM notifications "
        f"WHERE kind = 'reply' AND target_id = '{thread_id}' ORDER BY created_at",
    )


def test_replies_notify_followers_who_may_see_them(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=True, hidden=False)
    thread = ok(
        api(s.people["owner"]).post(
            f"{s.base}/threads", json=thread_body({"kind": "point", "geometry": POINT})
        )
    ).json()
    path = f"{s.base}/threads/{thread['id']}"
    owner(
        database,
        "INSERT INTO notification_mutes (tenant_id, user_id, subject, subject_id) "
        f"SELECT tenant_id, '{s.user('owner')}', 'task', id FROM review_tasks "
        f"WHERE id = '{s.task}'",
    )
    ok(api(s.people["first"]).post(f"{path}/messages", json={"body": "First answers"}))
    rows = reply_rows(database, thread["id"])
    assert [(str(row[0]), row[2], str(row[3]), str(row[4])) for row in rows] == [
        (s.user("owner"), True, str(s.project), str(s.task))
    ]
    ok(api(s.people["second"]).post(f"{path}/messages", json={"body": "Second answers"}))
    told = {str(row[0]) for row in reply_rows(database, thread["id"])[1:]}
    assert told == {s.user("owner")}
    notification = rows[0][1]
    target = ok(api(s.people["owner"]).get(f"/api/me/notifications/{notification}/target")).json()
    assert target == {
        "kind": "thread",
        "project_id": str(s.project),
        "task_id": str(s.task),
        "slide_id": str(s.slide),
        "object_id": None,
        "job_id": None,
        "thread_id": thread["id"],
        "case_id": None,
        "resolved_from": None,
        "origin": {
            "route": "task",
            "project_id": str(s.project),
            "case_id": None,
            "task_id": str(s.task),
            "slide_id": None,
        },
    }
    assert api(s.people["owner"]).delete(f"{path}?confirm=true").status_code == 204
    gone = api(s.people["owner"]).get(f"/api/me/notifications/{notification}/target")
    assert gone.status_code == 404
    assert code_of(gone) == "target-gone"


def mention(s: Study, who: str) -> str:
    return token_for(s.people[who].user_id)


def mention_rows(database: str, thread_id: str) -> list[tuple[str, bool]]:
    return [
        (str(row[0]), bool(row[1]))
        for row in owner(
            database,
            "SELECT user_id, muted FROM notifications "
            f"WHERE kind = 'mention' AND target_id = '{thread_id}' ORDER BY created_at, user_id",
        )
    ]


def test_a_mention_notifies_the_colleague_and_breaks_a_mute(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    owner(
        database,
        "INSERT INTO notification_mutes (tenant_id, user_id, subject, subject_id) "
        f"SELECT tenant_id, '{s.user('second')}', 'task', id FROM review_tasks "
        f"WHERE id = '{s.task}'",
    )
    people = f"{mention(s, 'owner')} and {mention(s, 'second')} please check, {mention(s, 'first')}"
    opening = {
        "title": "Who looks?",
        "body": people,
        "anchor": {"kind": "point", "geometry": POINT},
    }
    thread = ok(api(s.people["first"]).post(f"{s.base}/threads", json=opening)).json()
    assert thread["messages"][0]["mentions"] == [s.user("owner"), s.user("second"), s.user("first")]
    assert sorted(mention_rows(database, thread["id"])) == sorted(
        [(s.user("owner"), False), (s.user("second"), False)]
    )
    path = f"{s.base}/threads/{thread['id']}"
    reply = ok(
        api(s.people["owner"]).post(
            f"{path}/messages", json={"body": f"Thanks {mention(s, 'first')}"}
        )
    ).json()
    assert reply["mentions"] == [s.user("first")]
    assert [row[0] for row in mention_rows(database, thread["id"])].count(s.user("first")) == 1
    assert reply_rows(database, thread["id"]) == []
    ok(api(s.people["owner"]).post(f"{path}/messages", json={"body": "No mention"}))
    assert {str(row[0]) for row in reply_rows(database, thread["id"])} == {s.user("first")}
    rows = audit_rows(database, thread["id"])
    assert rows[0][1]["mentions"] == 2
    assert "@[" not in json.dumps([details for _, details in rows])


def test_only_members_who_see_the_task_slide_can_be_mentioned(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    point = {"kind": "point", "geometry": POINT}
    for who in ("third", "admin"):
        refused = api(s.people["first"]).post(
            f"{s.base}/threads",
            json={"title": "Nope", "body": f"Hello {mention(s, who)}", "anchor": point},
        )
        assert refused.status_code == 400, who
        assert code_of(refused) == "bad-mention", who
    stranger = api(s.people["first"]).post(
        f"{s.base}/threads",
        json={"title": "Nope", "body": f"Hello {token_for(uuid.uuid4())}", "anchor": point},
    )
    assert stranger.status_code == 400
    assert code_of(stranger) == "bad-mention"
    assert titles(api, s, "first") == []
    crowd = " ".join(token_for(uuid.uuid4()) for _ in range(MAX_MENTIONS + 1))
    too_many = api(s.people["first"]).post(
        f"{s.base}/threads", json={"title": "Crowd", "body": crowd, "anchor": point}
    )
    assert too_many.status_code == 400
    thread = ok(start(api, s, "first", point)).json()
    path = f"{s.base}/threads/{thread['id']}"
    refused_reply = api(s.people["owner"]).post(
        f"{path}/messages", json={"body": mention(s, "third")}
    )
    assert refused_reply.status_code == 400
    assert len(ok(api(s.people["first"]).get(path)).json()["messages"]) == 1
    assert mention_rows(database, thread["id"]) == []


def test_a_blinded_reviewer_cannot_mention_another_reviewer(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=True, hidden=False)
    point = {"kind": "point", "geometry": POINT}
    refused = api(s.people["first"]).post(
        f"{s.base}/threads",
        json={"title": "Peek", "body": f"Hello {mention(s, 'second')}", "anchor": point},
    )
    assert refused.status_code == 400
    assert code_of(refused) == "bad-mention"
    researchers = ok(start(api, s, "owner", point)).json()
    path = f"{s.base}/threads/{researchers['id']}/messages"
    blind = api(s.people["first"]).post(path, json={"body": f"Hello {mention(s, 'second')}"})
    assert blind.status_code == 400
    answer = ok(api(s.people["first"]).post(path, json={"body": f"Hello {mention(s, 'owner')}"}))
    assert answer.json()["mentions"] == [s.user("owner")]
    assert mention_rows(database, researchers["id"]) == [(s.user("owner"), False)]


def test_the_mentionable_list_holds_members_who_see_the_slide_and_each_other(
    api: ApiAs, database: str
) -> None:
    s = study(api, database, blinded=False, hidden=False)

    def listed(study_: Study, who: str) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = ok(
            api(study_.people[who]).get(f"{study_.base}/threads/mentionable")
        ).json()
        return found

    assert {entry["user_id"] for entry in listed(s, "first")} == {
        s.user(who) for who in ("owner", "viewer", "second")
    }
    assert {entry["user_id"] for entry in listed(s, "owner")} == {
        s.user(who) for who in ("viewer", "first", "second")
    }
    assert set(listed(s, "first")[0]) == {"user_id", "display_name", "initials", "avatar_colour"}
    blind = study(api, database, blinded=True, hidden=False)
    assert {entry["user_id"] for entry in listed(blind, "first")} == {
        blind.user(who) for who in ("owner", "viewer")
    }
    assert api(blind.people["third"]).get(f"{blind.base}/threads/mentionable").status_code == 404
