from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import Workspace, make_workspace, owner

from parfocal_api.tables import Role

pytestmark = pytest.mark.db


def later(**delta: float) -> str:
    return (datetime.now(UTC) + timedelta(**delta)).isoformat()


def team(database: str) -> Workspace:
    return make_workspace(
        database, {"researcher": Role.RESEARCHER, "reviewer": Role.REVIEWER, "admin": Role.ADMIN}
    )


def post(api: ApiAs, w: Workspace, **body: Any) -> Any:
    response = api(w.people["admin"]).post("/api/announcements", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def texts(api: ApiAs, w: Workspace, who: str) -> list[str]:
    response = api(w.people[who]).get("/api/announcements")
    assert response.status_code == 200, response.text
    return [entry["text"] for entry in response.json()]


def test_admins_post_announcements_that_every_member_lists_newest_first(
    api: ApiAs, database: str
) -> None:
    w = team(database)
    first = post(api, w, kind="model", text="  CellViT is now one of the models  ")
    post(api, w, kind="slowdown", text="The lab server is slow until 13:00", ends_at=later(hours=2))
    assert first["text"] == "CellViT is now one of the models"
    assert first["created_by_user_id"] == str(w.people["admin"].user_id)
    expected = ["The lab server is slow until 13:00", "CellViT is now one of the models"]
    for who in ("researcher", "reviewer", "admin"):
        assert texts(api, w, who) == expected
    assert owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE target_id = '{first['id']}' AND action = 'announcement.posted'",
    ) == [('{"kind":"model"}',)]


def test_an_announcement_disappears_when_it_expires_or_is_ended(api: ApiAs, database: str) -> None:
    w = team(database)
    lasting = post(api, w, kind="change", text="New: hold Z for a whole-slide peek")
    expiring = post(api, w, kind="slowdown", text="Maintenance tonight", ends_at=later(hours=1))
    owner(
        database,
        "UPDATE announcements SET ends_at = now() - interval '1 second' "
        f"WHERE id = '{expiring['id']}'",
    )
    assert texts(api, w, "reviewer") == ["New: hold Z for a whole-slide peek"]
    ended = api(w.people["admin"]).post(f"/api/announcements/{lasting['id']}/end")
    assert ended.status_code == 200, ended.text
    assert ended.json()["ends_at"] is not None
    assert texts(api, w, "reviewer") == []
    again = api(w.people["admin"]).post(f"/api/announcements/{lasting['id']}/end")
    assert again.json()["ends_at"] == ended.json()["ends_at"]
    assert owner(
        database,
        "SELECT count(*) FROM audit_events "
        f"WHERE target_id = '{lasting['id']}' AND action = 'announcement.ended'",
    ) == [(1,)]


def test_announcements_are_checked_and_only_admins_post_or_end_them(
    api: ApiAs, database: str
) -> None:
    w = team(database)
    admin = api(w.people["admin"])
    past = admin.post(
        "/api/announcements", json={"kind": "change", "text": "Late", "ends_at": later(hours=-1)}
    )
    assert (past.status_code, past.json()["code"]) == (400, "ends-in-the-past")
    assert admin.post("/api/announcements", json={"kind": "outage", "text": "x"}).status_code == 422
    assert (
        admin.post("/api/announcements", json={"kind": "change", "text": "   "}).status_code == 422
    )
    assert (
        admin.post("/api/announcements", json={"kind": "change", "text": "x" * 281}).status_code
        == 422
    )
    missing = admin.post("/api/announcements/00000000-0000-0000-0000-000000000000/end")
    assert (missing.status_code, missing.json()["code"]) == (404, "announcement-not-found")
    posted = post(api, w, kind="change", text="Only admins")
    for who in ("researcher", "reviewer"):
        person = api(w.people[who])
        assert (
            person.post("/api/announcements", json={"kind": "change", "text": "x"}).status_code
            == 403
        )
        assert person.post(f"/api/announcements/{posted['id']}/end").status_code == 403
    assert texts(api, w, "reviewer") == ["Only admins"]
