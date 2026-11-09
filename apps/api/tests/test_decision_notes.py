import json
import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_blinding import Study, ok, study
from workspace_support import owner

from parfocal_api.mentions import token_for

pytestmark = pytest.mark.db


def mention(s: Study, who: str) -> str:
    return token_for(s.people[who].user_id)


def decide(api: ApiAs, s: Study, who: str, note: str, object_id: str = "T1") -> Any:
    return api(s.people[who]).put(
        f"{s.base}/verdicts/{object_id}", json={"value": "disagree", "note": note}
    )


def note_rows(database: str, s: Study) -> list[tuple[str, dict[str, Any], bool]]:
    return [
        (
            str(row[0]),
            row[1] if isinstance(row[1], dict) else json.loads(str(row[1])),
            bool(row[2]),
        )
        for row in owner(
            database,
            "SELECT user_id, payload, muted FROM notifications WHERE kind = 'mention' "
            f"AND target_type = 'decision' AND target_id = '{s.slide}' "
            "ORDER BY created_at, user_id",
        )
    ]


def told(database: str, s: Study) -> list[str]:
    return sorted(person for person, _, _ in note_rows(database, s))


def notes_seen(api: ApiAs, s: Study, who: str) -> list[tuple[str, str]]:
    found = ok(api(s.people[who]).get(f"{s.base}/decision-notes")).json()
    return [(note["author_id"], note["note"]) for note in found]


def test_a_note_mention_tells_each_colleague_once_and_breaks_a_mute(
    api: ApiAs, database: str
) -> None:
    s = study(api, database, blinded=False, hidden=False)
    owner(
        database,
        "INSERT INTO notification_mutes (tenant_id, user_id, subject, subject_id) "
        f"SELECT tenant_id, '{s.user('second')}', 'task', id FROM review_tasks "
        f"WHERE id = '{s.task}'",
    )
    saved = ok(decide(api, s, "first", f"Ask {mention(s, 'owner')} and {mention(s, 'second')}"))
    assert saved.json()["note"].startswith("Ask @[")
    assert told(database, s) == sorted([s.user("owner"), s.user("second")])
    payload = note_rows(database, s)[0][1]
    assert payload == {
        "task_id": str(s.task),
        "slide_id": str(s.slide),
        "object_id": "T1",
        "actor_user_id": s.user("first"),
    }
    assert all(not muted for _, _, muted in note_rows(database, s))

    ok(decide(api, s, "first", f"Ask {mention(s, 'owner')} and {mention(s, 'second')} again"))
    assert len(note_rows(database, s)) == 2
    ok(decide(api, s, "first", f"Ask {mention(s, 'viewer')} and {mention(s, 'first')} too"))
    assert told(database, s) == sorted([s.user("owner"), s.user("second"), s.user("viewer")])

    audits = owner(
        database,
        "SELECT details FROM audit_events WHERE action = 'review.verdict-set' "
        f"AND target_id = '{s.task}' ORDER BY seq",
    )
    details: list[dict[str, Any]] = [json.loads(json.dumps(row[0])) for row in audits]
    assert [item["mentions"] for item in details[-3:]] == [2, 2, 1]
    assert "@[" not in json.dumps(details)


def test_a_note_cannot_mention_someone_who_cannot_see_the_slide(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    for body in (
        f"Hello {mention(s, 'third')}",
        f"Hello {mention(s, 'admin')}",
        f"Hello {token_for(uuid.uuid4())}",
    ):
        refused = decide(api, s, "first", body)
        assert refused.status_code == 400, body
        assert refused.json()["code"] == "bad-mention"
    assert ok(api(s.people["first"]).get(f"{s.base}/verdicts")).json() == []
    assert told(database, s) == []


def test_a_blinded_reviewers_note_waits_until_they_submit(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=True, hidden=False)
    hidden_peer = decide(api, s, "first", f"Peek {mention(s, 'second')}")
    assert hidden_peer.status_code == 400
    assert hidden_peer.json()["code"] == "bad-mention"

    ok(decide(api, s, "first", f"Margin is off, {mention(s, 'owner')}"))
    assert told(database, s) == []
    owner(
        database,
        f"UPDATE verdicts SET note = 'Second agrees' WHERE task_id = '{s.task}' "
        f"AND user_id = '{s.user('second')}'",
    )
    assert notes_seen(api, s, "first") == [
        (s.user("first"), f"Margin is off, {mention(s, 'owner')}")
    ]
    assert len(notes_seen(api, s, "owner")) == 2

    ok(api(s.people["first"]).post(f"{s.base}/submit"))
    assert told(database, s) == [s.user("owner")]
    assert len(notes_seen(api, s, "first")) == 2
    ok(api(s.people["first"]).post(f"{s.base}/reopen"))
    ok(api(s.people["first"]).post(f"{s.base}/submit"))
    assert told(database, s) == [s.user("owner")]


def test_the_bell_opens_the_note_for_its_recipient_only(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    ok(decide(api, s, "first", f"Look here {mention(s, 'second')}"))
    notification_id = owner(
        database,
        f"SELECT id FROM notifications WHERE target_type = 'decision' "
        f"AND user_id = '{s.user('second')}'",
    )[0][0]
    path = f"/api/me/notifications/{notification_id}/target"
    found = ok(api(s.people["second"]).get(path)).json()
    assert {key: found[key] for key in ("kind", "task_id", "slide_id", "object_id")} == {
        "kind": "decision",
        "task_id": str(s.task),
        "slide_id": str(s.slide),
        "object_id": "T1",
    }
    assert found["origin"]["route"] == "task"
    assert api(s.people["first"]).get(path).status_code == 404
    inbox = ok(api(s.people["second"]).get("/api/me/notifications")).json()["notifications"]
    assert [item["target_kind"] for item in inbox] == ["decision"]
    owner(
        database,
        f"UPDATE review_assignments SET released_at = now() WHERE task_id = '{s.task}' "
        f"AND user_id = '{s.user('second')}'",
    )
    gone = api(s.people["second"]).get(path)
    assert gone.status_code == 404
