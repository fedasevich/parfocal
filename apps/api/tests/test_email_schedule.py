from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from db_support import ApiAs
from sqlalchemy.ext.asyncio import AsyncConnection
from test_notifications import run, send, team
from workspace_support import Workspace, owner

from parfocal_api.notifications import deliver_pending_emails
from parfocal_api.tables import NotificationKind
from parfocal_common.clients import MemoryEmailSender

pytestmark = pytest.mark.db

PRAGUE = ZoneInfo("Europe/Prague")


def schedule(database: str, w: Workspace, **values: str) -> None:
    assignments = ", ".join(f"{column} = '{value}'" for column, value in values.items())
    owner(database, f"UPDATE users SET {assignments} WHERE id = '{w.people['ana'].user_id}'")


def deliver(database: str, w: Workspace, at: datetime) -> list[str]:
    sender = MemoryEmailSender()

    async def go(connection: AsyncConnection) -> int:
        return await deliver_pending_emails(connection, sender, "https://parfocal.test", at)

    run(database, w.tenant_id, go)
    return [message.template for message in sender.sent]


def statuses(database: str, w: Workspace) -> list[str]:
    return [
        str(row[0])
        for row in owner(
            database,
            "SELECT email_status FROM notifications "
            f"WHERE tenant_id = '{w.tenant_id}' ORDER BY created_at, kind",
        )
    ]


def tonight(hour: int) -> datetime:
    today = datetime.now(PRAGUE).date()
    return datetime(today.year, today.month, today.day, hour, tzinfo=PRAGUE).astimezone(UTC)


def test_quiet_hours_hold_emails_except_mandatory_ones_and_release_them_as_a_digest(
    database: str,
) -> None:
    w = team(database)
    schedule(database, w, quiet_from="22:00", quiet_until="07:00", time_zone="Europe/Prague")
    send(database, w, NotificationKind.TASK_ASSIGNED, "ana")
    send(database, w, NotificationKind.EMERGENCY_ACCESS, "ana")
    send(database, w, NotificationKind.MENTION, "ana")
    assert deliver(database, w, tonight(23)) == ["notification.emergency-access"]
    assert deliver(database, w, tonight(23) + timedelta(hours=7)) == []
    assert deliver(database, w, tonight(23) + timedelta(hours=9)) == ["notification.digest"]
    assert statuses(database, w) == ["sent", "sent", "sent"]


def test_an_hourly_digest_batches_what_arrives_within_the_hour(database: str) -> None:
    w = team(database)
    schedule(database, w, email_digest="hourly")
    send(database, w, NotificationKind.TASK_ASSIGNED, "ana")
    send(database, w, NotificationKind.MENTION, "ana")
    now = datetime.now(UTC)
    assert deliver(database, w, now + timedelta(minutes=10)) == []
    assert statuses(database, w) == ["pending", "pending"]
    assert deliver(database, w, now + timedelta(minutes=61)) == ["notification.digest"]
    assert statuses(database, w) == ["sent", "sent"]


def test_a_daily_digest_with_one_item_sends_that_item(database: str) -> None:
    w = team(database)
    schedule(database, w, email_digest="daily")
    send(database, w, NotificationKind.TASK_ASSIGNED, "ana")
    now = datetime.now(UTC)
    assert deliver(database, w, now + timedelta(hours=2)) == []
    assert deliver(database, w, now + timedelta(hours=25)) == ["notification.task-assigned"]


def test_people_set_their_own_schedule(api: ApiAs, database: str) -> None:
    w = team(database)
    ana = w.people["ana"]
    assert api(ana).get("/api/me/email-schedule").json() == {
        "digest": "off",
        "quiet_from": None,
        "quiet_until": None,
        "time_zone": "UTC",
    }
    chosen = {
        "digest": "daily",
        "quiet_from": "21:30:00",
        "quiet_until": "06:00:00",
        "time_zone": "Europe/Prague",
    }
    saved = api(ana).put("/api/me/email-schedule", json=chosen)
    assert (saved.status_code, saved.json()) == (200, chosen)
    assert (
        api(ana).put("/api/me/email-schedule", json={"time_zone": "Mars/Base"}).status_code == 422
    )
    assert (
        api(ana).put("/api/me/email-schedule", json={"quiet_from": "22:00:00"}).status_code == 422
    )
    assert api(ana).put("/api/me/email-schedule", json={"digest": "weekly"}).status_code == 422
    assert api(ana).get("/api/me/email-schedule").json() == chosen
