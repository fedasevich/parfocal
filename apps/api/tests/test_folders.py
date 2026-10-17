import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import OWNER_URL, ApiAs, query, with_database

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

FOLDERS = "/api/tenant/folders"


@dataclass(frozen=True)
class Lab:
    tenant_id: uuid.UUID
    people: dict[Role, MemberPrincipal]


def owner(database: str, statement: str) -> list[tuple[object, ...]]:
    return query(with_database(OWNER_URL, database), statement)


def make_lab(database: str) -> Lab:
    slug = f"fld-{uuid.uuid4().hex[:10]}"
    tenant_id = uuid.UUID(
        str(
            owner(
                database,
                "WITH organisation AS (INSERT INTO organisations (slug, name) "
                f"VALUES ('{slug}', '{slug}') RETURNING id) "
                "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
                f"SELECT id, '{slug}', '{slug}', 'diagnostic', 'eu', 'pilot' FROM organisation "
                "RETURNING id",
            )[0][0]
        )
    )
    people: dict[Role, MemberPrincipal] = {}
    for role in (Role.LEAD, Role.LAB, Role.CONSULTANT, Role.ADMIN):
        subject = f"{slug}-{role}"
        user_id = uuid.UUID(
            str(
                owner(
                    database,
                    "INSERT INTO users (subject, display_name, initials, avatar_colour) "
                    f"VALUES ('{subject}', '{role}', 'PP', 1) RETURNING id",
                )[0][0]
            )
        )
        owner(
            database,
            "INSERT INTO memberships (tenant_id, user_id, role, all_folders) "
            f"VALUES ('{tenant_id}', '{user_id}', '{role}', {str(role is Role.LEAD).lower()})",
        )
        people[role] = MemberPrincipal(subject, tenant_id, user_id, role)
    return Lab(tenant_id, people)


def new_case(api: ApiAs, lab: Lab, **extra: Any) -> dict[str, Any]:
    body = {
        "patient": {"name": "Folder Patient"},
        "accession": f"FO-{uuid.uuid4().hex[:8]}",
        "specimens": [{"letter": "A"}],
    } | extra
    response = api(lab.people[Role.LEAD]).post("/api/cases", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_folders_count_open_cases_and_hold_people(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    lead = lab.people[Role.LEAD]
    nodes = api(lead).post(FOLDERS, json={"name": "Lymph nodes", "colour": 3}).json()
    skin = api(lead).post(FOLDERS, json={"name": "Skin"}).json()
    new_case(api, lab, folder_id=nodes["id"])
    new_case(api, lab, folder_id=nodes["id"])
    new_case(api, lab, folder_id=nodes["id"], draft=True)
    consultant = lab.people[Role.CONSULTANT].user_id
    people = api(lead).put(f"{FOLDERS}/{nodes['id']}/people", json={"user_ids": [str(consultant)]})
    assert people.json()["people"] == [str(consultant)]
    listed = api(lab.people[Role.CONSULTANT]).get(FOLDERS).json()
    assert [(f["name"], f["colour"], f["open_cases"], len(f["people"])) for f in listed] == [
        ("Lymph nodes", 3, 2, 1),
        ("Skin", 0, 0, 0),
    ]
    assert skin["open_cases"] == 0


def test_a_case_moves_between_folders_and_is_audited(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    lead = lab.people[Role.LEAD]
    first = api(lead).post(FOLDERS, json={"name": "Breast"}).json()
    second = api(lead).post(FOLDERS, json={"name": "GI"}).json()
    case = new_case(api, lab, folder_id=first["id"])
    assert case["folder_id"] == first["id"]
    moved = api(lead).put(f"/api/cases/{case['id']}/folder", json={"folder_id": second["id"]})
    assert moved.json() == {"folder_id": second["id"]}
    assert api(lead).get(f"/api/cases/{case['id']}").json()["folder_id"] == second["id"]
    details = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE target_id = '{case['id']}' AND action = 'case.filed'",
    )
    assert details == [(f'{{"from":"{first["id"]}","to":"{second["id"]}"}}',)]


def test_archived_folders_take_no_new_cases(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    lead = lab.people[Role.LEAD]
    old = api(lead).post(FOLDERS, json={"name": "Old"}).json()
    archived = api(lead).patch(f"{FOLDERS}/{old['id']}", json={"archived": True}).json()
    assert archived["archived_at"] is not None
    case = new_case(api, lab)
    refused = api(lead).put(f"/api/cases/{case['id']}/folder", json={"folder_id": old["id"]})
    assert (refused.status_code, refused.json()["code"]) == (409, "folder-archived")
    restored = api(lead).patch(
        f"{FOLDERS}/{old['id']}", json={"archived": False, "name": "Current"}
    )
    assert (restored.json()["archived_at"], restored.json()["name"]) == (None, "Current")


def test_names_are_unique_and_people_must_be_members(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    lead = lab.people[Role.LEAD]
    folder = api(lead).post(FOLDERS, json={"name": "Skin"}).json()
    again = api(lead).post(FOLDERS, json={"name": "Skin"})
    assert (again.status_code, again.json()["code"]) == (409, "folder-name-taken")
    stranger = api(lead).put(
        f"{FOLDERS}/{folder['id']}/people", json={"user_ids": [str(uuid.uuid4())]}
    )
    assert (stranger.status_code, stranger.json()["code"]) == (400, "not-members")
    for bad in ({"name": ""}, {"name": "X", "colour": 12}):
        assert api(lead).post(FOLDERS, json=bad).status_code == 422


def test_another_workspace_cannot_use_a_folder(api: ApiAs, database: str) -> None:
    mine, theirs = make_lab(database), make_lab(database)
    folder = api(mine.people[Role.LEAD]).post(FOLDERS, json={"name": "Private"}).json()
    their_case = new_case(api, theirs)
    response = api(theirs.people[Role.LEAD]).put(
        f"/api/cases/{their_case['id']}/folder", json={"folder_id": folder["id"]}
    )
    assert response.status_code == 404
    created = api(theirs.people[Role.LEAD]).post(
        "/api/cases",
        json={
            "patient": {"name": "X"},
            "accession": "FO-X",
            "specimens": [{"letter": "A"}],
            "folder_id": folder["id"],
        },
    )
    assert created.status_code == 404
    assert api(theirs.people[Role.LEAD]).get(FOLDERS).json() == []


def test_who_may_change_folders(api: ApiAs, database: str) -> None:
    lab = make_lab(database)
    for role in (Role.CONSULTANT, Role.LAB, Role.ADMIN):
        assert api(lab.people[role]).post(FOLDERS, json={"name": f"By {role}"}).status_code == 403
