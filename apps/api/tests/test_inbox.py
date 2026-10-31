import asyncio
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, with_database
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from test_my_work import task
from test_review_tasks import Study, study
from workspace_support import Workspace, make_project, make_workspace, owner

from parfocal_api.notifications import deliver_pending_emails, notify
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import NotificationKind, Role, notification_mutes
from parfocal_common.clients import MemoryEmailSender
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction

pytestmark = pytest.mark.db

INBOX = "/api/me/notifications"
COUNTS = "/api/me/notifications/counts"
READ = "/api/me/notifications/read"
MUTES = "/api/me/notification-mutes"


def run[T](database: str, tenant: uuid.UUID, work: Callable[[AsyncConnection], Awaitable[T]]) -> T:
    async def go() -> T:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant)) as connection:
                return await work(connection)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def send(
    database: str,
    tenant: uuid.UUID,
    people: list[MemberPrincipal],
    kind: NotificationKind,
    target_type: str,
    target: uuid.UUID,
    payload: dict[str, Any] | None = None,
) -> int:
    async def work(connection: AsyncConnection) -> int:
        return await notify(
            connection,
            tenant,
            [who.user_id for who in people],
            kind,
            target_type,
            target,
            payload,
        )

    return run(database, tenant, work)


def kinds_for(database: str, who: MemberPrincipal) -> list[str]:
    rows = owner(
        database,
        f"SELECT kind FROM notifications WHERE user_id = '{who.user_id}' ORDER BY kind",
    )
    return [str(row[0]) for row in rows]


def read_at(database: str, notification_id: str) -> object:
    return owner(database, f"SELECT read_at FROM notifications WHERE id = '{notification_id}'")[0][
        0
    ]


def pair(database: str) -> Workspace:
    return make_workspace(database, {"ana": Role.RESEARCHER, "ben": Role.REVIEWER})


def fill(database: str, w: Workspace) -> None:
    ana, ben = w.people["ana"], w.people["ben"]
    for kind in (
        NotificationKind.MENTION,
        NotificationKind.REPLY,
        NotificationKind.TASK_ASSIGNED,
        NotificationKind.MODEL_RUN_FINISHED,
        NotificationKind.MENTION,
    ):
        send(database, w.tenant_id, [ana], kind, "task", uuid.uuid4())
    send(database, w.tenant_id, [ben], NotificationKind.MENTION, "task", uuid.uuid4())


def test_the_inbox_lists_my_notifications_newest_first_and_filters_them(
    api: ApiAs, database: str
) -> None:
    w = pair(database)
    fill(database, w)
    listed = api(w.people["ana"]).get(INBOX)
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["next_cursor"] is None
    items = body["notifications"]
    assert [item["kind"] for item in items] == [
        "mention",
        "model-run-finished",
        "task-assigned",
        "reply",
        "mention",
    ]
    first = items[0]
    assert first["link"] == f"/go/{first['id']}"
    assert (first["target_kind"], first["read"], first["read_at"]) == ("thread", False, None)
    assert first["created_at"] >= items[-1]["created_at"]
    mentions = api(w.people["ana"]).get(INBOX, params={"kind": "mention"}).json()
    assert [item["kind"] for item in mentions["notifications"]] == ["mention", "mention"]
    several = api(w.people["ana"]).get(INBOX, params={"kind": ["reply", "task-assigned"]}).json()
    assert {item["kind"] for item in several["notifications"]} == {"reply", "task-assigned"}
    marked = api(w.people["ana"]).post(READ, json={"ids": [first["id"]]})
    assert marked.json() == {"marked": 1, "unread": 4}
    unread = api(w.people["ana"]).get(INBOX, params={"read": "false"}).json()
    assert first["id"] not in {item["id"] for item in unread["notifications"]}
    assert len(unread["notifications"]) == 4
    done = api(w.people["ana"]).get(INBOX, params={"read": "true"}).json()["notifications"]
    assert [(item["id"], item["read"]) for item in done] == [(first["id"], True)]
    assert api(w.people["ana"]).get(INBOX, params={"kind": "nothing"}).status_code == 422


def test_pages_follow_the_cursor_without_gaps_or_repeats(api: ApiAs, database: str) -> None:
    w = pair(database)
    fill(database, w)
    seen: list[str] = []
    cursor: str | None = None
    pages = 0
    while True:
        params: dict[str, Any] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = api(w.people["ana"]).get(INBOX, params=params).json()
        seen.extend(item["id"] for item in page["notifications"])
        pages += 1
        cursor = page["next_cursor"]
        if cursor is None:
            break
    everything = [item["id"] for item in api(w.people["ana"]).get(INBOX).json()["notifications"]]
    assert (seen, pages) == (everything, 3)
    bad = api(w.people["ana"]).get(INBOX, params={"cursor": "not-a-cursor"})
    assert (bad.status_code, bad.json()["code"]) == (400, "bad-cursor")


def test_counts_give_the_total_and_unread_per_kind(api: ApiAs, database: str) -> None:
    w = pair(database)
    fill(database, w)
    first = api(w.people["ana"]).get(INBOX, params={"kind": "mention"}).json()["notifications"][0]
    api(w.people["ana"]).post(READ, json={"ids": [first["id"]]})
    counts = api(w.people["ana"]).get(COUNTS).json()
    assert (counts["total"], counts["unread"]) == (5, 4)
    by_kind = {row["kind"]: (row["total"], row["unread"]) for row in counts["kinds"]}
    assert by_kind["mention"] == (2, 1)
    assert by_kind["reply"] == (1, 1)
    assert by_kind["emergency-access"] == (0, 0)
    assert len(by_kind) == len(NotificationKind)


def test_bulk_read_changes_only_my_own_unread_notifications(api: ApiAs, database: str) -> None:
    w = pair(database)
    fill(database, w)
    mine = [item["id"] for item in api(w.people["ana"]).get(INBOX).json()["notifications"]]
    (theirs,) = [item["id"] for item in api(w.people["ben"]).get(INBOX).json()["notifications"]]
    marked = api(w.people["ana"]).post(READ, json={"ids": [*mine[:2], theirs, str(uuid.uuid4())]})
    assert marked.json() == {"marked": 2, "unread": 3}
    assert read_at(database, theirs) is None
    earlier = read_at(database, mine[0])
    assert earlier is not None
    again = api(w.people["ana"]).post(READ, json={"ids": mine[:2]})
    assert again.json() == {"marked": 0, "unread": 3}
    assert read_at(database, mine[0]) == earlier
    assert api(w.people["ben"]).get(COUNTS).json()["unread"] == 1


def test_mark_all_read_takes_kinds_and_a_time_limit(api: ApiAs, database: str) -> None:
    w = pair(database)
    fill(database, w)
    replies = api(w.people["ana"]).post(READ, json={"all": True, "kinds": ["reply", "mention"]})
    assert replies.json() == {"marked": 3, "unread": 2}
    shown = api(w.people["ana"]).get(INBOX).json()["notifications"]
    oldest = min(item["created_at"] for item in shown)
    send(
        database, w.tenant_id, [w.people["ana"]], NotificationKind.UPLOAD_DONE, "job", uuid.uuid4()
    )
    limited = api(w.people["ana"]).post(READ, json={"all": True, "up_to": oldest})
    assert limited.json() == {"marked": 0, "unread": 3}
    everything = api(w.people["ana"]).post(READ, json={"all": True})
    assert everything.json() == {"marked": 3, "unread": 0}
    assert read_at(database, api(w.people["ben"]).get(INBOX).json()["notifications"][0]["id"]) is (
        None
    )
    for body in (
        {},
        {"all": True, "ids": [str(uuid.uuid4())]},
        {"ids": [str(uuid.uuid4())], "kinds": ["reply"]},
        {"ids": [str(uuid.uuid4()) for _ in range(201)]},
    ):
        assert api(w.people["ana"]).post(READ, json=body).status_code == 422, body


def job_in(database: str, s: Study) -> uuid.UUID:
    return uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO jobs (tenant_id, project_id, kind) "
                f"VALUES ('{s.tenant_id}', '{s.project}', 'model-run') RETURNING id",
            )[0][0]
        )
    )


def mute(api: ApiAs, who: MemberPrincipal, subject: str, subject_id: object) -> Any:
    return api(who).put(f"{MUTES}/{subject}/{subject_id}")


def rows_for(database: str, who: MemberPrincipal, kind: str) -> list[tuple[object, ...]]:
    return owner(
        database,
        "SELECT muted, in_app, realtime, email_status FROM notifications "
        f"WHERE user_id = '{who.user_id}' AND kind = '{kind}' ORDER BY created_at",
    )


KEPT_SILENT = (True, True, False, "none")
DELIVERED = (False, True, True, "pending")


def with_email(database: str, *people: MemberPrincipal) -> None:
    for who in people:
        owner(
            database,
            f"UPDATE users SET email = 'p-{uuid.uuid4().hex[:8]}@example.test' "
            f"WHERE id = '{who.user_id}'",
        )


def test_a_muted_event_is_kept_in_the_inbox_without_a_push_or_an_email(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    people = s.people
    first, second, lead = people["first"], people["second"], people["owner"]
    with_email(database, first, second, lead)
    created = task(api, s, name="Round 1", reviewer_ids=[s.user("first"), s.user("second")])
    task_id = uuid.UUID(created["id"])
    assert mute(api, first, "task", task_id).status_code == 200
    send(database, s.tenant_id, [first, second], NotificationKind.TASK_SIGNED_OFF, "task", task_id)
    assert rows_for(database, first, "task-signed-off") == [KEPT_SILENT]
    assert rows_for(database, second, "task-signed-off") == [DELIVERED]
    for kind in (
        NotificationKind.TASK_ASSIGNED,
        NotificationKind.TASK_DUE_SOON,
        NotificationKind.MENTION,
    ):
        send(database, s.tenant_id, [first], kind, "task", task_id)
        assert rows_for(database, first, kind) == [DELIVERED], kind

    assert mute(api, first, "case", s.case).status_code == 200
    for slide in (s.slides[2], s.slides[0]):
        send(
            database,
            s.tenant_id,
            [lead, first],
            NotificationKind.RESULT_SET_ADDED,
            "slide",
            slide,
            {"object_id": "T1"},
        )
    in_case = owner(
        database,
        "SELECT target_id, muted, realtime FROM notifications "
        f"WHERE user_id = '{first.user_id}' AND kind = 'result-set-added' ORDER BY muted",
    )
    assert in_case == [(s.slides[0], False, True), (s.slides[2], True, False)]
    assert [row[0] for row in rows_for(database, lead, "result-set-added")] == [False, False]

    job = job_in(database, s)
    assert mute(api, lead, "project", s.project).status_code == 200
    send(database, s.tenant_id, [lead], NotificationKind.MODEL_RUN_PAUSED, "job", job)
    send(database, s.tenant_id, [lead], NotificationKind.TASK_ASSIGNED, "task", task_id)
    send(
        database,
        s.tenant_id,
        [lead],
        NotificationKind.EMERGENCY_ACCESS,
        "project",
        s.project,
        {"hours": 4},
    )
    assert rows_for(database, lead, "model-run-paused") == [KEPT_SILENT]
    assert rows_for(database, lead, "task-assigned") == [DELIVERED]
    assert rows_for(database, lead, "emergency-access") == [DELIVERED]

    sender = MemoryEmailSender()

    async def deliver(connection: AsyncConnection) -> int:
        return await deliver_pending_emails(connection, sender, "https://parfocal.test")

    run(database, s.tenant_id, deliver)
    templates = [message.template for message in sender.sent]
    assert "notification.model-run-paused" not in templates
    assert "notification.task-signed-off" in templates

    assert api(lead).delete(f"{MUTES}/project/{s.project}").json() == []
    assert rows_for(database, lead, "model-run-paused") == [KEPT_SILENT]
    kept = api(lead).get(INBOX, params={"muted": "true"}).json()["notifications"]
    assert [(item["kind"], item["muted"]) for item in kept] == [("model-run-paused", True)]
    send(database, s.tenant_id, [lead], NotificationKind.MODEL_RUN_PAUSED, "job", job)
    assert rows_for(database, lead, "model-run-paused") == [KEPT_SILENT, DELIVERED]
    sender.sent.clear()
    run(database, s.tenant_id, deliver)
    assert [message.template for message in sender.sent] == ["notification.model-run-paused"]


def test_muted_rows_stay_out_of_the_main_list_and_the_badge(api: ApiAs, database: str) -> None:
    s = study(database)
    first = s.people["first"]
    created = task(api, s, name="Round 1", reviewer_ids=[s.user("first")])
    task_id = uuid.UUID(created["id"])
    assert mute(api, first, "task", task_id).status_code == 200
    for kind in (NotificationKind.TASK_SIGNED_OFF, NotificationKind.TASK_SIGNED_OFF):
        send(database, s.tenant_id, [first], kind, "task", task_id)
    send(database, s.tenant_id, [first], NotificationKind.TASK_ASSIGNED, "task", task_id)
    main = api(first).get(INBOX).json()["notifications"]
    assert [(item["kind"], item["muted"]) for item in main] == [("task-assigned", False)]
    silent = api(first).get(INBOX, params={"muted": "true", "read": "false"}).json()
    assert [(item["kind"], item["muted"]) for item in silent["notifications"]] == [
        ("task-signed-off", True),
        ("task-signed-off", True),
    ]
    counts = api(first).get(COUNTS).json()
    assert (counts["total"], counts["unread"], counts["muted"], counts["muted_unread"]) == (
        1,
        1,
        2,
        2,
    )
    by_kind = {row["kind"]: (row["total"], row["unread"]) for row in counts["kinds"]}
    assert by_kind["task-signed-off"] == (0, 0)
    assert by_kind["task-assigned"] == (1, 1)
    one = silent["notifications"][0]["id"]
    assert api(first).post(READ, json={"ids": [one]}).json() == {"marked": 1, "unread": 1}
    assert api(first).post(READ, json={"all": True}).json() == {"marked": 2, "unread": 0}
    after = api(first).get(COUNTS).json()
    assert (after["unread"], after["muted"], after["muted_unread"]) == (0, 2, 0)
    assert api(first).get(INBOX, params={"muted": "true", "read": "false"}).json() == {
        "notifications": [],
        "next_cursor": None,
    }


def test_the_inbox_carries_the_project_task_and_case_of_each_notification(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    created = task(api, s, name="Round 1", reviewer_ids=[s.user("first")])
    first = s.people["first"]
    send(
        database,
        s.tenant_id,
        [first],
        NotificationKind.RESULT_SET_ADDED,
        "slide",
        s.slides[2],
        {"task_id": created["id"], "object_id": "T3"},
    )
    task_id = uuid.UUID(created["id"])
    send(database, s.tenant_id, [first], NotificationKind.TASK_ASSIGNED, "task", task_id)
    items = api(first).get(INBOX).json()["notifications"]
    context = {
        item["kind"]: (item["target_kind"], item["project_id"], item["task_id"], item["case_id"])
        for item in items
    }
    assert context == {
        "task-assigned": ("task", str(s.project), created["id"], None),
        "result-set-added": ("slide", str(s.project), created["id"], str(s.case)),
    }
    slide_item = next(item for item in items if item["kind"] == "result-set-added")
    assert slide_item["payload"] == {"task_id": created["id"], "object_id": "T3"}
    assert slide_item["target_id"] == str(s.slides[2])


def test_muting_skips_pending_emails_for_that_subject_and_lets_work_through(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    first = s.people["first"]
    with_email(database, first)
    owner(database, f"UPDATE users SET email_digest = 'hourly' WHERE id = '{first.user_id}'")
    created = task(api, s, name="Round 1", reviewer_ids=[s.user("first")])
    task_id = uuid.UUID(created["id"])
    other_project = make_project(database, s.tenant_id, "de-identified")
    owner(
        database,
        "INSERT INTO project_members (tenant_id, project_id, user_id, role) "
        f"VALUES ('{s.tenant_id}', '{other_project}', '{first.user_id}', 'viewer')",
    )
    for kind in (
        NotificationKind.TASK_SIGNED_OFF,
        NotificationKind.TASK_DUE_SOON,
        NotificationKind.MENTION,
    ):
        send(database, s.tenant_id, [first], kind, "task", task_id)
    send(
        database, s.tenant_id, [first], NotificationKind.EMERGENCY_ACCESS, "project", other_project
    )
    assert mute(api, first, "task", task_id).status_code == 200
    statuses = owner(
        database,
        "SELECT kind, email_status, muted FROM notifications "
        f"WHERE user_id = '{first.user_id}' ORDER BY kind",
    )
    assert statuses == [
        ("emergency-access", "pending", False),
        ("mention", "pending", False),
        ("task-due-soon", "pending", False),
        ("task-signed-off", "skipped", False),
    ]
    send(database, s.tenant_id, [first], NotificationKind.TASK_SIGNED_OFF, "task", task_id)
    assert rows_for(database, first, "task-signed-off")[1] == KEPT_SILENT
    sender = MemoryEmailSender()

    async def deliver(connection: AsyncConnection) -> int:
        return await deliver_pending_emails(connection, sender, "https://parfocal.test")

    assert run(database, s.tenant_id, deliver) == 1
    assert [message.template for message in sender.sent] == ["notification.emergency-access"]
    pending = owner(
        database,
        "SELECT kind FROM notifications "
        f"WHERE user_id = '{first.user_id}' AND email_status = 'pending' ORDER BY kind",
    )
    assert pending == [("mention",), ("task-due-soon",)]


def test_only_what_a_person_can_read_can_be_muted(api: ApiAs, database: str) -> None:
    s = study(database)
    people = s.people
    task(api, s, name="Round 1", reviewer_ids=[s.user("first")])
    created = task(api, s, name="Round 2", reviewer_ids=[s.user("first")])
    for who, subject, subject_id in (
        ("third", "task", created["id"]),
        ("outsider", "project", s.project),
        ("third", "case", s.case),
        ("owner", "case", uuid.uuid4()),
        ("owner", "task", uuid.uuid4()),
        ("admin", "project", s.project),
    ):
        refused = mute(api, people[who], subject, subject_id)
        assert (refused.status_code, refused.json()["code"]) == (
            404,
            "mute-subject-not-found",
        ), (who, subject)
    assert mute(api, people["first"], "slide", s.slides[0]).status_code == 422
    for subject, subject_id in (("case", s.case), ("task", created["id"]), ("project", s.project)):
        muted = mute(api, people["first"], subject, subject_id)
        assert muted.status_code == 200, muted.text
    again = mute(api, people["first"], "case", s.case).json()
    assert [(row["subject"], row["subject_id"]) for row in again] == [
        ("case", str(s.case)),
        ("task", created["id"]),
        ("project", str(s.project)),
    ]
    assert api(people["first"]).get(MUTES).json() == again
    assert api(people["owner"]).get(MUTES).json() == []
    left = api(people["first"]).delete(f"{MUTES}/task/{created['id']}").json()
    assert [row["subject"] for row in left] == ["case", "project"]
    gone = api(people["first"]).delete(f"{MUTES}/task/{created['id']}")
    assert (gone.status_code, len(gone.json())) == (200, 2)


def test_the_inbox_and_mutes_stay_in_their_workspace(api: ApiAs, database: str) -> None:
    mine, theirs = pair(database), pair(database)
    fill(database, mine)
    ana = mine.people["ana"]
    owner(
        database,
        "INSERT INTO memberships (tenant_id, user_id, role) "
        f"VALUES ('{theirs.tenant_id}', '{ana.user_id}', 'researcher')",
    )
    elsewhere = MemberPrincipal(ana.subject, theirs.tenant_id, ana.user_id, Role.RESEARCHER)
    project = make_project(database, mine.tenant_id, "de-identified")
    owner(
        database,
        "INSERT INTO project_members (tenant_id, project_id, user_id, role) "
        f"VALUES ('{mine.tenant_id}', '{project}', '{ana.user_id}', 'owner')",
    )
    assert mute(api, ana, "project", project).status_code == 200
    assert api(elsewhere).get(INBOX).json() == {"notifications": [], "next_cursor": None}
    counts = api(elsewhere).get(COUNTS).json()
    assert (counts["total"], counts["unread"], counts["muted"]) == (0, 0, 0)
    assert api(elsewhere).get(MUTES).json() == []
    assert api(elsewhere).post(READ, json={"all": True}).json() == {"marked": 0, "unread": 0}
    ids = [item["id"] for item in api(ana).get(INBOX).json()["notifications"]]
    assert api(elsewhere).post(READ, json={"ids": ids}).json()["marked"] == 0
    assert api(ana).get(COUNTS).json()["unread"] == 5
    stolen = mute(api, theirs.people["ana"], "project", project)
    assert (stolen.status_code, stolen.json()["code"]) == (404, "mute-subject-not-found")
    api(theirs.people["ana"]).delete(f"{MUTES}/project/{project}")
    assert len(api(ana).get(MUTES).json()) == 1

    async def visible(connection: AsyncConnection) -> int:
        return len((await connection.execute(select(notification_mutes))).all())

    assert run(database, theirs.tenant_id, visible) == 0
    assert run(database, mine.tenant_id, visible) == 1
