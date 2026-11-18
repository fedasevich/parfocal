import asyncio
import uuid
from datetime import date
from types import SimpleNamespace
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, with_database
from test_adjudications import queued, send
from test_review_tasks import Study, create, study
from workspace_support import join_project, owner, person

from parfocal_api import deactivation
from parfocal_api.auth import CheckedSession, SessionLimits
from parfocal_api.evaluation_exports import CHECKSUM_HEADER
from parfocal_api.tables import Role
from parfocal_common.db import create_engine

pytestmark = pytest.mark.db

TODAY = date(2026, 11, 20)


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(deactivation, "utc_today", lambda: TODAY)


def staffed(database: str) -> Study:
    s = study(database)
    spare = person(database, s.tenant_id, "spare", Role.REVIEWER)
    join_project(database, s.project, spare, "reviewer")
    return Study(
        s.tenant_id,
        s.people | {"spare": spare},
        s.project,
        s.case,
        s.slides,
        s.sets,
        s.other_set,
        s.importing_set,
    )


def made(api: ApiAs, s: Study) -> dict[str, Any]:
    response = create(api, s, split="even")
    assert response.status_code == 201, response.text
    return response.json()


def deactivate(api: ApiAs, s: Study, who: str, **body: Any) -> Any:
    return api(s.people["admin"]).post(f"/api/tenant/members/{s.user(who)}/deactivation", json=body)


def open_work(api: ApiAs, s: Study, who: str) -> list[dict[str, Any]]:
    response = api(s.people["admin"]).get(f"/api/tenant/members/{s.user(who)}/open-work")
    assert response.status_code == 200, response.text
    return response.json()["items"]


def add_thread(database: str, s: Study, task: dict[str, Any], who: str) -> str:
    return str(
        owner(
            database,
            "INSERT INTO threads (tenant_id, project_id, task_id, slide_id, title, anchor_kind, "
            "geometry, created_by_user_id) VALUES "
            f"('{s.tenant_id}', '{s.project}', '{task['id']}', '{task['slides'][0]['slide_id']}', "
            f"'Look here', 'point', '{{\"x\": 1, \"y\": 2}}', '{s.user(who)}') RETURNING id",
        )[0][0]
    )


def add_session(database: str, s: Study, who: str) -> None:
    owner(
        database,
        "INSERT INTO sessions (id_hash, subject, tokens, access_expires_at, expires_at, "
        "active_tenant_id) VALUES "
        f"(decode('{uuid.uuid4().hex}', 'hex'), '{s.people[who].subject}', "
        f"decode('{'00' * 40}', 'hex'), "
        f"now() + interval '1 hour', now() + interval '1 day', '{s.tenant_id}')",
    )


def sessions_of(database: str, s: Study, who: str) -> int:
    rows = owner(
        database, f"SELECT count(*) FROM sessions WHERE subject = '{s.people[who].subject}'"
    )
    return int(str(rows[0][0]))


def sweep(database: str, today: date) -> list[uuid.UUID]:
    async def go() -> list[uuid.UUID]:
        engine = create_engine(with_database(APP_URL, database))
        try:
            return await deactivation.finish_due_deactivations(engine, today)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def state_of(database: str, s: Study, who: str) -> tuple[object, object]:
    row = owner(
        database,
        "SELECT deactivates_on, deactivated_at IS NOT NULL FROM memberships "
        f"WHERE user_id = '{s.user(who)}'",
    )[0]
    return row[0], row[1]


def test_a_deactivation_with_open_work_is_refused_and_lists_the_items(
    api: ApiAs, database: str
) -> None:
    s = staffed(database)
    task = made(api, s)
    add_thread(database, s, task, "first")
    refused = deactivate(api, s, "first")
    assert refused.status_code == 409, refused.text
    body = refused.json()
    assert body["code"] == "open-work"
    assert sorted(item["kind"] for item in body["current"]["items"]) == [
        "open-thread",
        "review-slides",
    ]
    assert state_of(database, s, "first") == (None, False)

    partial = deactivate(
        api,
        s,
        "first",
        handovers=[
            {
                "kind": "review-slides",
                "id": task["id"],
                "action": "reassign",
                "to_user_id": s.user("spare"),
            }
        ],
    )
    assert (partial.status_code, partial.json()["code"]) == (409, "open-work")
    assert [item["kind"] for item in partial.json()["current"]["items"]] == ["open-thread"]
    assert state_of(database, s, "first") == (None, False)
    unrelated = deactivate(
        api, s, "first", handovers=[{"kind": "owned-task", "id": task["id"], "action": "return"}]
    )
    assert (unrelated.status_code, unrelated.json()["code"]) == (400, "not-open-work")
    assert deactivate(api, s, "admin").json()["code"] == "own-deactivation"
    assert (
        api(s.people["owner"])
        .post(f"/api/tenant/members/{s.user('first')}/deactivation", json={})
        .status_code
        == 403
    )


def test_a_deactivation_moves_every_item_and_ends_sessions_but_keeps_history(
    api: ApiAs, database: str
) -> None:
    s = staffed(database)
    task = made(api, s)
    thread = add_thread(database, s, task, "first")
    mine = [
        slide["slide_id"] for slide in task["slides"] if s.user("first") in slide["reviewer_ids"]
    ]
    assert mine
    add_session(database, s, "first")
    owner(
        database,
        "INSERT INTO review_decisions (tenant_id, project_id, task_id, slide_id, user_id, kind, "
        f"number, value, style, answer) VALUES ('{s.tenant_id}', '{s.project}', '{task['id']}', "
        f"'{mine[0]}', '{s.user('first')}', 'region', 1, 'agree', 'agree', 'agree')",
    )
    kinds = {item["kind"] for item in open_work(api, s, "first")}
    assert kinds == {"review-slides", "open-thread"}

    done = deactivate(
        api,
        s,
        "first",
        handovers=[
            {
                "kind": "review-slides",
                "id": task["id"],
                "action": "reassign",
                "to_user_id": s.user("spare"),
            },
            {"kind": "open-thread", "id": thread, "action": "return"},
        ],
    )
    assert done.status_code == 200, done.text
    assert (done.json()["state"], done.json()["ends_on"]) == ("deactivated", None)
    assert open_work(api, s, "first") == []
    assert state_of(database, s, "first") == (None, True)
    assert sessions_of(database, s, "first") == 0

    held = owner(
        database,
        "SELECT slide_id::text, released_at IS NOT NULL FROM review_assignments "
        f"WHERE task_id = '{task['id']}' AND user_id = '{s.user('spare')}' ORDER BY slide_id",
    )
    assert sorted(str(row[0]) for row in held) == sorted(mine)
    left = owner(
        database,
        "SELECT slide_id::text FROM review_assignments "
        f"WHERE task_id = '{task['id']}' AND user_id = '{s.user('first')}' "
        "AND released_at IS NULL",
    )
    assert left == []
    assert owner(
        database, f"SELECT count(*) FROM review_decisions WHERE user_id = '{s.user('first')}'"
    ) == [(1,)]
    assert owner(
        database, f"SELECT resolved_by_user_id::text FROM threads WHERE id = '{thread}'"
    ) == [(s.user("admin"),)]
    actions = {
        str(row[0])
        for row in owner(database, "SELECT action FROM audit_events WHERE tenant_id IS NOT NULL")
    }
    assert {"member.deactivated", "member.handed-over"} <= actions

    people = api(s.people["admin"]).get("/api/tenant/members").json()
    assert s.user("first") in {member["user_id"] for member in people}
    again = deactivate(api, s, "first")
    assert (again.status_code, again.json()["code"]) == (409, "already-deactivated")
    activity = {
        item["user_id"]: item
        for item in api(s.people["admin"]).get("/api/tenant/members/activity").json()
    }
    assert activity[s.user("first")]["deactivated_at"] is not None


def test_task_ownership_and_slides_can_be_returned_instead_of_reassigned(
    api: ApiAs, database: str
) -> None:
    s = staffed(database)
    task = made(api, s)
    items = {(item["kind"], item["id"]) for item in open_work(api, s, "owner")}
    assert ("owned-task", task["id"]) in items
    wrong = deactivate(
        api,
        s,
        "owner",
        handovers=[
            {
                "kind": "owned-task",
                "id": task["id"],
                "action": "reassign",
                "to_user_id": s.user("spare"),
            }
        ],
    )
    assert (wrong.status_code, wrong.json()["code"]) == (400, "cannot-take-over")
    returned = deactivate(
        api, s, "owner", handovers=[{"kind": "owned-task", "id": task["id"], "action": "return"}]
    )
    assert returned.status_code == 200, returned.text
    assert owner(
        database, f"SELECT created_by_user_id FROM review_tasks WHERE id = '{task['id']}'"
    ) == [(None,)]

    again = made(api, s)
    mine = open_work(api, s, "second")
    assert sorted(item["id"] for item in mine) == sorted([task["id"], again["id"]])
    sent_back = deactivate(
        api,
        s,
        "second",
        handovers=[{"kind": item["kind"], "id": item["id"], "action": "return"} for item in mine],
    )
    assert sent_back.status_code == 200, sent_back.text
    assert owner(
        database,
        f"SELECT count(*) FROM review_assignments WHERE user_id = '{s.user('second')}' "
        "AND released_at IS NULL",
    ) == [(0,)]


def test_an_adjudication_moves_to_another_adjudicator_or_returns_to_the_owner(
    api: ApiAs, database: str
) -> None:
    r, task = queued(api, database)
    admin = person(
        database, r.people["owner"].tenant_id, "admin", Role.RESEARCHER, admin_rights=True
    )
    spare = person(database, r.people["owner"].tenant_id, "spare", Role.REVIEWER)
    join_project(database, r.project, spare, "reviewer")
    sent = send(api, r, task, "third", ["T1", "T2"])
    assert sent.status_code == 201, sent.text
    adjudication = sent.json()[0]["adjudication"]["id"]
    url = f"/api/tenant/members/{r.people['third'].user_id}"
    items = api(admin).get(f"{url}/open-work").json()["items"]
    assert [(item["kind"], item["id"], item["count"]) for item in items] == [
        ("adjudication", adjudication, 2)
    ]
    handover = {"kind": "adjudication", "id": adjudication}
    outsider = api(admin).post(
        f"{url}/deactivation",
        json={
            "handovers": [
                handover | {"action": "reassign", "to_user_id": str(r.people["viewer"].user_id)}
            ]
        },
    )
    assert (outsider.status_code, outsider.json()["code"]) == (400, "not-a-project-reviewer")
    moved = api(admin).post(
        f"{url}/deactivation",
        json={"handovers": [handover | {"action": "reassign", "to_user_id": str(spare.user_id)}]},
    )
    assert moved.status_code == 200, moved.text
    taken = api(spare).get("/api/adjudications/objects", params={"task_id": str(r.task)})
    assert sorted(item["object"] for item in taken.json()) == ["T1", "T2"]
    assert api(spare).get("/api/adjudications").json()[0]["objects"] == ["T1", "T2"]

    url = f"/api/tenant/members/{spare.user_id}"
    declined = api(admin).post(
        f"{url}/deactivation", json={"handovers": [handover | {"action": "return"}]}
    )
    assert declined.status_code == 200, declined.text
    assert owner(
        database, f"SELECT declined_at IS NOT NULL FROM adjudications WHERE id = '{adjudication}'"
    ) == [(True,)]


def test_a_scheduled_end_date_runs_on_a_fake_clock_and_returns_what_arrived_since(
    api: ApiAs, database: str
) -> None:
    s = staffed(database)
    task = made(api, s)
    ends_on = date(2026, 12, 1)
    past = deactivate(api, s, "third", ends_on="2026-11-19")
    assert (past.status_code, past.json()["code"]) == (400, "end-date-in-the-past")
    refused = deactivate(api, s, "third", ends_on=ends_on.isoformat())
    assert (refused.status_code, refused.json()["code"]) == (409, "open-work")
    slide = next(x for x in task["slides"] if s.user("third") in x["reviewer_ids"])
    scheduled = deactivate(
        api,
        s,
        "third",
        ends_on=ends_on.isoformat(),
        handovers=[
            {
                "kind": "review-slides",
                "id": task["id"],
                "action": "reassign",
                "to_user_id": s.user("spare"),
            }
        ],
    )
    assert scheduled.status_code == 200, scheduled.text
    assert (scheduled.json()["state"], scheduled.json()["ends_on"]) == ("scheduled", "2026-12-01")
    assert slide["slide_id"] in {
        str(row[0])
        for row in owner(
            database,
            f"SELECT slide_id FROM review_assignments WHERE user_id = '{s.user('spare')}'",
        )
    }
    add_session(database, s, "third")
    late_thread = add_thread(database, s, task, "third")
    assert state_of(database, s, "third") == (ends_on, False)

    assert sweep(database, date(2026, 11, 30)) == []
    assert state_of(database, s, "third") == (ends_on, False)
    assert sessions_of(database, s, "third") == 1

    assert sweep(database, ends_on) == [uuid.UUID(s.user("third"))]
    assert state_of(database, s, "third") == (ends_on, True)
    assert sessions_of(database, s, "third") == 0
    assert owner(
        database, f"SELECT resolved_at IS NOT NULL FROM threads WHERE id = '{late_thread}'"
    ) == [(True,)]
    assert sweep(database, date(2026, 12, 2)) == []
    system = owner(
        database,
        "SELECT count(*) FROM audit_events WHERE action = 'member.deactivated' "
        "AND actor_kind = 'system'",
    )
    assert system == [(1,)]


def test_a_scheduled_deactivation_can_be_cancelled_before_its_date(
    api: ApiAs, database: str
) -> None:
    s = staffed(database)
    scheduled = deactivate(api, s, "viewer", ends_on="2026-12-01")
    assert scheduled.status_code == 200, scheduled.text
    url = f"/api/tenant/members/{s.user('viewer')}/deactivation"
    assert api(s.people["admin"]).delete(url).status_code == 204
    assert state_of(database, s, "viewer") == (None, False)
    missing = api(s.people["admin"]).delete(url)
    assert (missing.status_code, missing.json()["code"]) == (404, "no-scheduled-deactivation")
    assert sweep(database, date(2026, 12, 5)) == []


def test_the_last_admin_stays_and_a_deactivated_member_resolves_to_no_workspace(
    api: ApiAs, database: str
) -> None:
    s = staffed(database)
    second_admin = person(database, s.tenant_id, "admin-two", Role.RESEARCHER, admin_rights=True)
    moved_on = api(second_admin).post(
        f"/api/tenant/members/{s.user('admin')}/deactivation", json={}
    )
    assert moved_on.status_code == 200, moved_on.text
    last = api(s.people["admin"]).post(
        f"/api/tenant/members/{second_admin.user_id}/deactivation", json={}
    )
    assert (last.status_code, last.json()["code"]) == (409, "last-admin")

    row = SimpleNamespace(
        subject="ws-x",
        user_id=uuid.uuid4(),
        active_tenant_id=s.tenant_id,
        operator=False,
        member_role="researcher",
        member_admin_rights=False,
        tenant_status="active",
        member_deactivated_at=None,
        tokens=b"",
    )
    limits = SessionLimits(idle=None, lifetime=None)  # type: ignore[arg-type]
    assert CheckedSession(row, {}, limits).resolved().role is Role.RESEARCHER
    row.member_deactivated_at = TODAY
    assert CheckedSession(row, {}, limits).resolved().role is None


def test_a_signed_off_evaluation_still_verifies_after_its_reviewer_is_deactivated(
    api: ApiAs, database: str
) -> None:
    r, task = queued(api, database)
    admin = person(
        database, r.people["owner"].tenant_id, "admin", Role.RESEARCHER, admin_rights=True
    )
    decide = f"{task}/disagreements/{r.slide}"
    api(r.people["owner"]).put(f"{decide}/T1", json={"answer": "agree"})
    api(r.people["owner"]).put(f"{decide}/T2", json={"answer": "disagree"})
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200
    before = api(r.people["owner"]).get(f"{task}/sign-off-summary").json()["signature"]["checksum"]
    exported = api(r.people["owner"]).get(f"{task}/evaluation/exports/objects.csv")
    stored = owner(database, f"SELECT checksum FROM evaluation_versions WHERE task_id = '{r.task}'")
    assert stored == [(before,)]
    decisions = owner(database, "SELECT count(*) FROM review_decisions")

    url = f"/api/tenant/members/{r.people['first'].user_id}"
    assert api(admin).get(f"{url}/open-work").json()["items"] == []
    done = api(admin).post(f"{url}/deactivation", json={})
    assert done.status_code == 200, done.text

    after = api(r.people["owner"]).get(f"{task}/sign-off-summary").json()["signature"]["checksum"]
    again = api(r.people["owner"]).get(f"{task}/evaluation/exports/objects.csv")
    assert after == before
    assert again.headers[CHECKSUM_HEADER] == exported.headers[CHECKSUM_HEADER] == before
    assert again.text == exported.text
    assert owner(
        database, f"SELECT checksum FROM evaluation_versions WHERE task_id = '{r.task}'"
    ) == [(before,)]
    assert owner(database, "SELECT count(*) FROM review_decisions") == decisions
    kept = owner(
        database,
        f"SELECT count(*) FROM review_decisions WHERE user_id = '{r.people['first'].user_id}'",
    )
    assert int(str(kept[0][0])) > 0
