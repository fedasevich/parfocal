from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from db_support import ApiAs
from test_folder_access import Lab, make_lab, owner

from parfocal_api.principals import MemberPrincipal

pytestmark = pytest.mark.db


def later(**delta: float) -> str:
    return (datetime.now(UTC) + timedelta(**delta)).isoformat()


def set_status(api: ApiAs, who: MemberPrincipal, **body: Any) -> Any:
    return api(who).put("/api/me/availability", json=body)


def status_of(api: ApiAs, who: MemberPrincipal) -> dict[str, Any]:
    return api(who).get("/api/me/availability").json()


def expire(database: str, who: MemberPrincipal) -> None:
    owner(
        database,
        "UPDATE memberships SET available_again_at = now() - interval '1 second' "
        f"WHERE user_id = '{who.user_id}'",
    )


def test_everyone_starts_available(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    assert status_of(api, lab.people["nodes"]) == {
        "user_id": str(lab.people["nodes"].user_id),
        "status": "available",
        "until": None,
        "backup_user_id": None,
    }


def test_busy_lasts_until_its_end(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    nodes = lab.people["nodes"]
    response = set_status(api, nodes, status="busy", until=later(hours=1))
    assert response.status_code == 200, response.text
    assert status_of(api, nodes)["status"] == "busy"
    expire(database, nodes)
    assert status_of(api, nodes)["status"] == "available"


def test_away_names_a_back_up_and_may_end(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    nodes, lead = lab.people["nodes"], lab.people["lead"]
    response = set_status(api, nodes, status="away", backup_user_id=str(lead.user_id))
    assert response.json()["backup_user_id"] == str(lead.user_id)
    set_status(api, nodes, status="away", backup_user_id=str(lead.user_id), until=later(days=3))
    assert status_of(api, nodes)["status"] == "away"
    expire(database, nodes)
    assert status_of(api, nodes) == {
        "user_id": str(nodes.user_id),
        "status": "available",
        "until": None,
        "backup_user_id": None,
    }


def test_back_to_available(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    nodes = lab.people["nodes"]
    set_status(api, nodes, status="busy", until=later(hours=1))
    assert set_status(api, nodes, status="available").json()["status"] == "available"


@pytest.mark.parametrize(
    "body",
    [
        {"status": "busy"},
        {"status": "busy", "until": "PAST"},
        {"status": "busy", "until": "TWO_DAYS"},
        {"status": "away"},
        {"status": "available", "until": "HOUR"},
    ],
)
def test_invalid_statuses_are_refused(api: ApiAs, database: str, body: dict[str, str]) -> None:
    lab = make_lab(api, database)
    times = {"PAST": later(minutes=-1), "TWO_DAYS": later(days=2), "HOUR": later(hours=1)}
    if "until" in body:
        body = {**body, "until": times[body["until"]]}
    response = set_status(api, lab.people["nodes"], **body)
    assert (response.status_code, response.json()["code"]) == (400, "invalid-availability")
    assert status_of(api, lab.people["nodes"])["status"] == "available"


def test_the_back_up_must_be_another_member_who_is_not_away(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    nodes, lead, head = lab.people["nodes"], lab.people["lead"], lab.people["head"]
    other = make_lab(api, database).people["lead"]
    for backup in (nodes.user_id, other.user_id):
        response = set_status(api, nodes, status="away", backup_user_id=str(backup))
        assert (response.status_code, response.json()["code"]) == (400, "invalid-backup")
    set_status(api, lead, status="away", backup_user_id=str(head.user_id))
    response = set_status(api, nodes, status="away", backup_user_id=str(lead.user_id))
    assert response.json()["code"] == "invalid-backup"


def test_the_team_sees_everyones_status(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    set_status(api, lab.people["nodes"], status="busy", until=later(hours=2))
    team = {
        row["user_id"]: row["status"]
        for row in api(lab.people["lab"]).get("/api/tenant/availability").json()
    }
    assert team == {
        str(lab.people["head"].user_id): "available",
        str(lab.people["lead"].user_id): "available",
        str(lab.people["nodes"].user_id): "busy",
        str(lab.people["lab"].user_id): "available",
    }


def create_for(api: ApiAs, lab: Lab, assignee: MemberPrincipal) -> Any:
    response = api(lab.people["head"]).post(
        "/api/cases",
        json={
            "patient": {"name": "Covered"},
            "specimens": [{"letter": "A"}],
            "assignee_user_id": str(assignee.user_id),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_a_new_case_for_an_away_person_goes_to_the_back_up(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    nodes, lead = lab.people["nodes"], lab.people["lead"]
    set_status(api, nodes, status="away", backup_user_id=str(lead.user_id))
    case = create_for(api, lab, nodes)
    assert case["assignee_user_id"] == str(lead.user_id)
    set_status(api, nodes, status="away", backup_user_id=str(lead.user_id), until=later(days=1))
    expire(database, nodes)
    assert create_for(api, lab, nodes)["assignee_user_id"] == str(nodes.user_id)


def test_a_busy_person_keeps_new_cases(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    nodes = lab.people["nodes"]
    set_status(api, nodes, status="busy", until=later(hours=1))
    assert create_for(api, lab, nodes)["assignee_user_id"] == str(nodes.user_id)
