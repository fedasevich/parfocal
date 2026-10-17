from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import Workspace, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db


def later(**delta: float) -> str:
    return (datetime.now(UTC) + timedelta(**delta)).isoformat()


def team(database: str) -> Workspace:
    return make_workspace(database, {"lead": Role.LEAD, "nodes": Role.CONSULTANT, "lab": Role.LAB})


def set_status(api: ApiAs, who: MemberPrincipal, **body: Any) -> Any:
    return api(who).put("/api/me/availability", json=body)


def status_of(api: ApiAs, who: MemberPrincipal) -> dict[str, Any]:
    return api(who).get("/api/me/availability").json()


def available(who: MemberPrincipal) -> dict[str, Any]:
    return {"user_id": str(who.user_id), "status": "available", "until": None, "note": None}


def expire(database: str, who: MemberPrincipal) -> None:
    owner(
        database,
        "UPDATE memberships SET available_again_at = now() - interval '1 second' "
        f"WHERE user_id = '{who.user_id}'",
    )


def test_everyone_starts_available(api: ApiAs, database: str) -> None:
    nodes = team(database).people["nodes"]
    assert status_of(api, nodes) == available(nodes)


def test_away_with_a_note_and_no_end_stays_away(api: ApiAs, database: str) -> None:
    nodes = team(database).people["nodes"]
    response = set_status(api, nodes, status="away", note="  At a conference ")
    assert response.status_code == 200, response.text
    assert status_of(api, nodes) == {
        "user_id": str(nodes.user_id),
        "status": "away",
        "until": None,
        "note": "At a conference",
    }


def test_away_until_reads_as_available_after_its_end(api: ApiAs, database: str) -> None:
    nodes = team(database).people["nodes"]
    set_status(api, nodes, status="away", until=later(days=3), note="Leave")
    assert status_of(api, nodes)["status"] == "away"
    expire(database, nodes)
    assert status_of(api, nodes) == available(nodes)


def test_back_to_available(api: ApiAs, database: str) -> None:
    nodes = team(database).people["nodes"]
    set_status(api, nodes, status="away", until=later(hours=1))
    assert set_status(api, nodes, status="available").json() == available(nodes)


@pytest.mark.parametrize(
    "body",
    [
        {"status": "away", "until": "PAST"},
        {"status": "available", "until": "HOUR"},
        {"status": "available", "note": "Here"},
    ],
)
def test_invalid_statuses_are_refused(api: ApiAs, database: str, body: dict[str, str]) -> None:
    nodes = team(database).people["nodes"]
    times = {"PAST": later(minutes=-1), "HOUR": later(hours=1)}
    if "until" in body:
        body = {**body, "until": times[body["until"]]}
    response = set_status(api, nodes, **body)
    assert (response.status_code, response.json()["code"]) == (400, "invalid-availability")
    assert status_of(api, nodes) == available(nodes)


@pytest.mark.parametrize("body", [{"status": "busy"}, {"status": "away", "note": "x" * 201}])
def test_unknown_statuses_and_long_notes_are_refused(
    api: ApiAs, database: str, body: dict[str, str]
) -> None:
    nodes = team(database).people["nodes"]
    assert set_status(api, nodes, **body).status_code == 422


def test_the_team_sees_everyones_status(api: ApiAs, database: str) -> None:
    workspace = team(database)
    people = workspace.people
    set_status(api, people["nodes"], status="away", until=later(hours=2))
    statuses = {
        row["user_id"]: row["status"]
        for row in api(people["lab"]).get("/api/tenant/availability").json()
    }
    assert statuses == {
        str(people["lead"].user_id): "available",
        str(people["nodes"].user_id): "away",
        str(people["lab"].user_id): "available",
    }


def test_the_team_list_stays_inside_the_workspace(api: ApiAs, database: str) -> None:
    mine, other = team(database), team(database)
    set_status(api, other.people["nodes"], status="away")
    listed = {
        row["user_id"] for row in api(mine.people["lab"]).get("/api/tenant/availability").json()
    }
    assert listed == {str(who.user_id) for who in mine.people.values()}
