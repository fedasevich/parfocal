import uuid
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import Workspace, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

PROJECTS = "/api/projects"
PEOPLE = {
    "owner": Role.RESEARCHER,
    "colleague": Role.RESEARCHER,
    "reviewer": Role.REVIEWER,
    "admin": Role.ADMIN,
}


def team(database: str) -> Workspace:
    return make_workspace(database, PEOPLE)


def create(api: ApiAs, who: MemberPrincipal, **body: Any) -> Any:
    return api(who).post(PROJECTS, json={"name": "Sentinel node eval v2"} | body)


def made(api: ApiAs, who: MemberPrincipal, **body: Any) -> dict[str, Any]:
    response = create(api, who, **body)
    assert response.status_code == 201, response.text
    return response.json()


def add(api: ApiAs, by: MemberPrincipal, project: str, who: MemberPrincipal, role: str) -> Any:
    return api(by).put(f"{PROJECTS}/{project}/members/{who.user_id}", json={"role": role})


def actions(database: str, project: str) -> list[str]:
    rows = owner(
        database, f"SELECT action FROM audit_events WHERE target_id = '{project}' ORDER BY seq"
    )
    return [str(row[0]) for row in rows]


def test_a_researcher_creates_a_project_and_owns_it(api: ApiAs, database: str) -> None:
    people = team(database).people
    project = made(api, people["owner"])
    assert {key: project[key] for key in ("code", "number", "colour", "privacy_mode")} == {
        "code": "P01",
        "number": 1,
        "colour": 0,
        "privacy_mode": "de-identified",
    }
    assert (project["template"], project["archived_at"], project["my_role"]) == (
        "none",
        None,
        "owner",
    )
    assert project["members"] == [{"user_id": str(people["owner"].user_id), "role": "owner"}]
    details = owner(
        database, f"SELECT details FROM audit_events WHERE target_id = '{project['id']}'"
    )
    assert details == [('{"number":1,"privacy_mode":"de-identified","template":"none"}',)]


def test_numbers_count_up_per_workspace_and_are_not_reused(api: ApiAs, database: str) -> None:
    mine, theirs = team(database).people, team(database).people
    first = made(api, mine["owner"], privacy_mode="clinical", template="sentinel-node")
    api(mine["owner"]).post(f"{PROJECTS}/{first['id']}/archive")
    second = made(api, mine["colleague"], colour=4)
    assert (first["code"], second["code"], second["colour"]) == ("P01", "P02", 4)
    assert (first["privacy_mode"], first["template"]) == ("clinical", "sentinel-node")
    assert made(api, theirs["owner"])["code"] == "P01"


def test_people_see_only_the_projects_they_are_in(api: ApiAs, database: str) -> None:
    people = team(database).people
    project = made(api, people["owner"])
    path = f"{PROJECTS}/{project['id']}"
    for label in ("colleague", "reviewer"):
        assert api(people[label]).get(PROJECTS).json() == []
        assert api(people[label]).get(path).status_code == 404
    assert api(people["admin"]).get(path).status_code == 404
    assert (
        add(api, people["owner"], project["id"], people["reviewer"], "reviewer").status_code == 200
    )
    seen = api(people["reviewer"]).get(path).json()
    assert (seen["id"], seen["my_role"]) == (project["id"], "reviewer")
    assert [row["id"] for row in api(people["reviewer"]).get(PROJECTS).json()] == [project["id"]]


def test_another_workspace_gets_nothing(api: ApiAs, database: str) -> None:
    mine, theirs = team(database).people, team(database).people
    project = made(api, mine["owner"])
    assert api(theirs["owner"]).get(f"{PROJECTS}/{project['id']}").status_code == 404
    assert api(theirs["owner"]).get(PROJECTS).json() == []
    assert api(mine["owner"]).get(f"{PROJECTS}/{uuid.uuid4()}").status_code == 404


def test_an_owner_changes_the_project_and_each_change_is_audited(api: ApiAs, database: str) -> None:
    people = team(database).people
    project = made(api, people["owner"])
    path = f"{PROJECTS}/{project['id']}"
    changed = api(people["owner"]).patch(
        path, json={"name": " Breast cohort ", "colour": 7, "template": "cell-review"}
    )
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert (body["name"], body["colour"], body["template"]) == ("Breast cohort", 7, "cell-review")
    assert api(people["owner"]).patch(path, json={"colour": 7}).status_code == 200
    details = owner(
        database,
        f"SELECT details FROM audit_events WHERE target_id = '{project['id']}' "
        "AND action = 'project.changed'",
    )
    assert details == [('{"fields":["colour","name","template"]}',)]


def test_only_owners_change_a_project(api: ApiAs, database: str) -> None:
    people = team(database).people
    project = made(api, people["owner"])
    add(api, people["owner"], project["id"], people["colleague"], "viewer")
    path = f"{PROJECTS}/{project['id']}"
    attempts = [
        api(people["colleague"]).patch(path, json={"name": "Mine now"}),
        api(people["colleague"]).post(f"{path}/archive"),
        add(api, people["colleague"], project["id"], people["colleague"], "owner"),
    ]
    for response in attempts:
        assert (response.status_code, response.json()["code"]) == (403, "project-owners-only")
    assert api(people["reviewer"]).patch(path, json={"name": "x"}).status_code == 403


def test_an_archived_project_is_read_only_until_restored(api: ApiAs, database: str) -> None:
    people = team(database).people
    project = made(api, people["owner"], privacy_mode="clinical")
    path = f"{PROJECTS}/{project['id']}"
    archived = api(people["owner"]).post(f"{path}/archive").json()
    assert archived["archived_at"] is not None
    assert api(people["owner"]).post(f"{path}/archive").status_code == 200
    assert api(people["owner"]).get(PROJECTS).json() == []
    listed = api(people["owner"]).get(PROJECTS, params={"archived": True}).json()
    assert [row["id"] for row in listed] == [project["id"]]
    refusals = [
        api(people["owner"]).patch(path, json={"name": "Late"}),
        add(api, people["owner"], project["id"], people["colleague"], "viewer"),
        api(people["owner"]).post(
            "/api/cases", json={"project_id": project["id"], "label": "S26-1"}
        ),
    ]
    for response in refusals:
        assert (response.status_code, response.json()["code"]) == (409, "project-archived")
    restored = api(people["owner"]).post(f"{path}/restore").json()
    assert restored["archived_at"] is None
    assert actions(database, project["id"]) == [
        "project.created",
        "project.archived",
        "project.restored",
    ]


def test_owners_manage_members_within_the_rules(api: ApiAs, database: str) -> None:
    workspace = team(database)
    people = workspace.people
    project = made(api, people["owner"])["id"]
    lead = people["owner"]
    assert add(api, lead, project, people["reviewer"], "reviewer").status_code == 200
    refused = add(api, lead, project, people["reviewer"], "owner")
    assert (refused.status_code, refused.json()["code"]) == (400, "reviewers-cannot-own")
    stranger = team(database).people["owner"]
    refused = add(api, lead, project, stranger, "viewer")
    assert (refused.status_code, refused.json()["code"]) == (400, "not-a-member")
    alone = add(api, lead, project, lead, "viewer")
    assert (alone.status_code, alone.json()["code"]) == (409, "last-owner")
    leaving = api(lead).delete(f"{PROJECTS}/{project}/members/{lead.user_id}")
    assert (leaving.status_code, leaving.json()["code"]) == (409, "last-owner")
    assert add(api, lead, project, people["colleague"], "owner").status_code == 200
    assert add(api, lead, project, lead, "viewer").json()["my_role"] == "viewer"
    colleague = people["colleague"]
    removed = api(colleague).delete(f"{PROJECTS}/{project}/members/{people['reviewer'].user_id}")
    assert removed.status_code == 204
    members = api(colleague).get(f"{PROJECTS}/{project}").json()["members"]
    assert {(row["user_id"], row["role"]) for row in members} == {
        (str(colleague.user_id), "owner"),
        (str(lead.user_id), "viewer"),
    }
    missing = api(colleague).delete(f"{PROJECTS}/{project}/members/{people['reviewer'].user_id}")
    assert missing.status_code == 404
    changes = owner(
        database,
        "SELECT action, details FROM audit_events WHERE action LIKE 'project.member%' "
        f"AND tenant_id = '{workspace.tenant_id}' ORDER BY seq",
    )
    assert [row[0] for row in changes] == [
        "project.member-set",
        "project.member-set",
        "project.member-set",
        "project.member-removed",
    ]
    assert changes[-1][1] == f'{{"from":"reviewer","project_id":"{project}"}}'


def test_reviewers_and_admins_do_not_create_projects(api: ApiAs, database: str) -> None:
    people = team(database).people
    for label in ("reviewer", "admin"):
        assert create(api, people[label]).status_code == 403


@pytest.mark.parametrize(
    "body",
    [
        {"name": "   "},
        {"name": "x" * 121},
        {"colour": 12},
        {"privacy_mode": "open"},
        {"template": "staging"},
    ],
)
def test_invalid_projects_are_refused(api: ApiAs, database: str, body: dict[str, Any]) -> None:
    assert create(api, team(database).people["owner"], **body).status_code == 422
