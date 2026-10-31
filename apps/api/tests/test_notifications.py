import asyncio
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, with_database
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from workspace_support import Workspace, join_project, make_project, make_workspace, owner

from parfocal_api.notification_catalogue import DEFAULTS
from parfocal_api.notifications import deliver_pending_emails, notify
from parfocal_api.tables import NotificationKind, Role
from parfocal_common.clients import MemoryEmailSender
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction

pytestmark = pytest.mark.db

PREFERENCES = "/api/me/notification-preferences"
TARGET = uuid.uuid4()


def run[T](database: str, tenant: uuid.UUID, work: Callable[[AsyncConnection], Awaitable[T]]) -> T:
    async def go() -> T:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant)) as connection:
                return await work(connection)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def team(database: str) -> Workspace:
    workspace = make_workspace(
        database,
        {"ana": Role.RESEARCHER, "ben": Role.REVIEWER, "admin": Role.RESEARCHER},
        admins={"admin"},
    )
    for label in ("ana", "ben"):
        owner(
            database,
            f"UPDATE users SET email = '{label}-{uuid.uuid4().hex[:6]}@example.test' "
            f"WHERE id = '{workspace.people[label].user_id}'",
        )
    return workspace


def send(database: str, workspace: Workspace, kind: NotificationKind, *labels: str) -> int:
    people = [workspace.people[label].user_id for label in labels]

    async def work(connection: AsyncConnection) -> int:
        return await notify(connection, workspace.tenant_id, people, kind, "task", TARGET)

    return run(database, workspace.tenant_id, work)


def stored(database: str, workspace: Workspace) -> list[tuple[Any, ...]]:
    return owner(
        database,
        "SELECT u.display_name, n.kind, n.in_app, n.realtime, n.email_status "
        "FROM notifications n JOIN users u ON u.id = n.user_id "
        f"WHERE n.tenant_id = '{workspace.tenant_id}' ORDER BY u.display_name, n.kind",
    )


def test_defaults_route_each_kind(api: ApiAs, database: str) -> None:
    workspace = team(database)
    for kind in (NotificationKind.MENTION, NotificationKind.REPLY):
        assert send(database, workspace, kind, "ana") == 1
    assert stored(database, workspace) == [
        ("ana", "mention", True, True, "pending"),
        ("ana", "reply", True, True, "none"),
    ]
    listed = api(workspace.people["ana"]).get(PREFERENCES).json()
    assert {row["kind"]: row["email"] for row in listed} == {
        kind.value: channels.email for kind, channels in DEFAULTS.items()
    }


def test_preferences_change_the_route(api: ApiAs, database: str) -> None:
    workspace = team(database)
    changed = api(workspace.people["ben"]).put(
        PREFERENCES,
        json={
            "preferences": [
                {"kind": "mention", "in_app": True, "email": False, "realtime": False},
                {"kind": "upload-done", "in_app": False, "email": False, "realtime": False},
            ]
        },
    )
    assert changed.status_code == 200, changed.text
    mention = next(row for row in changed.json() if row["kind"] == "mention")
    assert (mention["email"], mention["realtime"]) == (False, False)
    send(database, workspace, NotificationKind.MENTION, "ana", "ben")
    assert send(database, workspace, NotificationKind.UPLOAD_DONE, "ben") == 0
    assert stored(database, workspace) == [
        ("ana", "mention", True, True, "pending"),
        ("ben", "mention", True, False, "none"),
    ]


def test_emergency_access_cannot_be_turned_off(api: ApiAs, database: str) -> None:
    workspace = team(database)
    refused = api(workspace.people["ana"]).put(
        PREFERENCES,
        json={
            "preferences": [
                {"kind": "emergency-access", "in_app": False, "email": False, "realtime": False}
            ]
        },
    )
    assert (refused.status_code, refused.json()["code"]) == (400, "mandatory-notification")
    listed = api(workspace.people["ana"]).get(PREFERENCES).json()
    emergency = next(row for row in listed if row["kind"] == "emergency-access")
    assert (emergency["mandatory"], emergency["email"]) == (True, True)


def test_pending_emails_are_sent_once_with_a_link_and_no_details(database: str) -> None:
    workspace = team(database)
    send(database, workspace, NotificationKind.TASK_ASSIGNED, "ana", "admin")
    sender = MemoryEmailSender()

    async def deliver(connection: AsyncConnection) -> int:
        return await deliver_pending_emails(connection, sender, "https://parfocal.test")

    assert run(database, workspace.tenant_id, deliver) == 1
    assert run(database, workspace.tenant_id, deliver) == 0
    (message,) = sender.sent
    assert message.template == "notification.task-assigned"
    assert message.subject.startswith("New review task in ")
    assert message.link in message.text
    assert "Hello ana," in message.text
    [(sent_id,)] = owner(
        database,
        "SELECT id FROM notifications WHERE email_status = 'sent' "
        f"AND tenant_id = '{workspace.tenant_id}'",
    )
    assert message.link == f"https://parfocal.test/go/{sent_id}"
    assert [row[4] for row in stored(database, workspace)] == ["skipped", "sent"]


def test_notifications_stay_in_their_workspace(database: str) -> None:
    mine, theirs = team(database), team(database)
    send(database, mine, NotificationKind.MENTION, "ana")

    async def visible(connection: AsyncConnection) -> int:
        return len((await connection.exec_driver_sql("SELECT id FROM notifications")).all())

    assert run(database, theirs.tenant_id, visible) == 0
    assert run(database, mine.tenant_id, visible) == 1
    stranger = theirs.people["ana"].user_id

    async def cross(connection: AsyncConnection) -> int:
        return await notify(
            connection, mine.tenant_id, [stranger], NotificationKind.MENTION, "task", TARGET
        )

    with pytest.raises(IntegrityError):
        run(database, mine.tenant_id, cross)


def test_emergency_access_notifies_the_project_owners(api: ApiAs, database: str) -> None:
    workspace = team(database)
    project = make_project(database, workspace.tenant_id)
    join_project(database, project, workspace.people["ana"], "owner")
    sender = api.app.clients.email
    assert isinstance(sender, MemoryEmailSender)
    before = len(sender.sent)
    granted = api(workspace.people["admin"]).post(
        f"/api/projects/{project}/emergency-access",
        json={"reason": "Patient asked about this result today"},
    )
    assert granted.status_code == 201, granted.text
    rows = owner(
        database,
        "SELECT u.display_name, n.kind, n.email_status, n.payload::text FROM notifications n "
        f"JOIN users u ON u.id = n.user_id WHERE n.tenant_id = '{workspace.tenant_id}'",
    )
    assert rows == [("ana", "emergency-access", "sent", '{"hours": 4}')]
    (message,) = sender.sent[before:]
    [(sent_id,)] = owner(
        database, f"SELECT id FROM notifications WHERE tenant_id = '{workspace.tenant_id}'"
    )
    assert message.link.endswith(f"/go/{sent_id}")
