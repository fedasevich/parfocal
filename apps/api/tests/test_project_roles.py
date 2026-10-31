import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs
from fastapi.testclient import TestClient
from workspace_support import (
    join_project,
    make_project,
    make_slide,
    make_workspace,
    owner,
    person,
)

from parfocal_api.permissions import Grant, Permission, grant_for, in_project
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import ProjectRole, Role

pytestmark = pytest.mark.db


@dataclass(frozen=True)
class Setup:
    tenant_id: uuid.UUID
    lead: MemberPrincipal
    subject: MemberPrincipal
    colleague: MemberPrincipal
    project: uuid.UUID
    case: str
    slide: uuid.UUID


def make_setup(
    api: ApiAs, database: str, workspace_role: Role, project_role: ProjectRole | None
) -> Setup:
    workspace = make_workspace(
        database,
        {"lead": Role.RESEARCHER, "subject": workspace_role, "colleague": Role.REVIEWER},
    )
    people = workspace.people
    project = make_project(database, workspace.tenant_id)
    join_project(database, project, people["lead"], "owner")
    join_project(database, project, people["colleague"], "viewer")
    if project_role is not None:
        join_project(database, project, people["subject"], project_role)
    case = api(people["lead"]).post(
        "/api/cases", json={"project_id": str(project), "label": f"S-{uuid.uuid4().hex[:6]}"}
    )
    assert case.status_code == 201, case.text
    return Setup(
        workspace.tenant_id,
        people["lead"],
        people["subject"],
        people["colleague"],
        project,
        case.json()["id"],
        make_slide(database, workspace.tenant_id, project, f"Slide {uuid.uuid4().hex[:6]}"),
    )


def effective(setup: Setup, role: ProjectRole | None, permission: Permission) -> Grant:
    return in_project(grant_for(setup.subject.role, permission), permission, role)


type Expect = Callable[[Setup, ProjectRole | None], int]


def lists(setup: Setup, role: ProjectRole | None) -> int:
    return (
        200
        if effective(setup, role, Permission.SEE_SLIDES) in {Grant.ALL, Grant.VIEW_ONLY}
        else 404
    )


def lists_membership(setup: Setup, role: ProjectRole | None) -> int:
    return 404 if role is None else 200


def hidden(setup: Setup) -> int:
    asks = grant_for(setup.subject.role, Permission.EMERGENCY_ACCESS) is Grant.EMERGENCY
    return 403 if asks else 404


def reads(setup: Setup, role: ProjectRole | None) -> int:
    if lists(setup, role) == 200:
        return 200
    return 404 if role is not None else hidden(setup)


def member_reads(setup: Setup, role: ProjectRole | None) -> int:
    return hidden(setup) if role is None else 200


def owner_changes(setup: Setup, role: ProjectRole | None) -> int:
    if grant_for(setup.subject.role, Permission.CREATE_CASES) is Grant.NONE:
        return 403
    if role is None:
        return 404
    return 200 if effective(setup, role, Permission.CREATE_CASES) is Grant.ALL else 403


def owner_creates(setup: Setup, role: ProjectRole | None) -> int:
    status = owner_changes(setup, role)
    return 201 if status == 200 else status


def owner_removes(setup: Setup, role: ProjectRole | None) -> int:
    status = owner_changes(setup, role)
    return 204 if status == 200 else status


def runs_models(setup: Setup, role: ProjectRole | None) -> int:
    if grant_for(setup.subject.role, Permission.RUN_MODELS) is Grant.NONE:
        return 403
    if role is None:
        return hidden(setup)
    return 201 if effective(setup, role, Permission.RUN_MODELS) is Grant.ALL else 403


@dataclass(frozen=True)
class Operation:
    call: Callable[[TestClient, Setup], Any]
    expect: Expect


def listed_cases(client: TestClient, setup: Setup) -> int:
    response = client.get("/api/cases")
    assert response.status_code == 200
    return 200 if setup.case in {row["id"] for row in response.json()} else 404


def listed_projects(client: TestClient, setup: Setup) -> int:
    response = client.get("/api/projects")
    assert response.status_code == 200
    return 200 if str(setup.project) in {row["id"] for row in response.json()} else 404


OPERATIONS: dict[str, Operation] = {
    "getProject": Operation(lambda c, s: c.get(f"/api/projects/{s.project}"), member_reads),
    "listProjects": Operation(listed_projects, lists_membership),
    "updateProject": Operation(
        lambda c, s: c.patch(f"/api/projects/{s.project}", json={"colour": 5}), owner_changes
    ),
    "archiveProject": Operation(
        lambda c, s: c.post(f"/api/projects/{s.project}/archive"), owner_changes
    ),
    "restoreProject": Operation(
        lambda c, s: c.post(f"/api/projects/{s.project}/restore"), owner_changes
    ),
    "setProjectMember": Operation(
        lambda c, s: c.put(
            f"/api/projects/{s.project}/members/{s.colleague.user_id}", json={"role": "reviewer"}
        ),
        owner_changes,
    ),
    "removeProjectMember": Operation(
        lambda c, s: c.delete(f"/api/projects/{s.project}/members/{s.colleague.user_id}"),
        owner_removes,
    ),
    "createCase": Operation(
        lambda c, s: c.post(
            "/api/cases", json={"project_id": str(s.project), "label": f"N-{uuid.uuid4().hex[:6]}"}
        ),
        owner_creates,
    ),
    "getCase": Operation(lambda c, s: c.get(f"/api/cases/{s.case}"), reads),
    "getOpinionForm": Operation(
        lambda c, s: c.get(f"/api/projects/{s.project}/opinion-form"), member_reads
    ),
    "publishOpinionForm": Operation(
        lambda c, s: c.put(
            f"/api/projects/{s.project}/opinion-form",
            json={"questions": [{"kind": "text", "key": "note", "label": "Note"}]},
        ),
        owner_changes,
    ),
    "listProjectClasses": Operation(
        lambda c, s: c.get(f"/api/projects/{s.project}/classes"), member_reads
    ),
    "setProjectClasses": Operation(
        lambda c, s: c.put(f"/api/projects/{s.project}/classes", json={"classes": []}),
        owner_changes,
    ),
    "listClassMappings": Operation(
        lambda c, s: c.get(f"/api/projects/{s.project}/class-mappings"), member_reads
    ),
    "resolveClassNames": Operation(
        lambda c, s: c.get(f"/api/projects/{s.project}/class-mappings/resolve?name=Tumor"),
        member_reads,
    ),
    "listCases": Operation(listed_cases, lists),
    "startModelRuns": Operation(
        lambda c, s: c.post(
            f"/api/projects/{s.project}/model-runs",
            json={
                "slide_ids": [str(s.slide)],
                "scope": {"kind": "slide"},
                "parameters": {"detector": {"name": "roles-detector", "version": "1"}},
            },
        ),
        runs_models,
    ),
    "listModelRuns": Operation(
        lambda c, s: c.get(f"/api/projects/{s.project}/model-runs"), member_reads
    ),
}

ROLES: list[tuple[Role, ProjectRole | None]] = [
    (Role.RESEARCHER, ProjectRole.OWNER),
    (Role.RESEARCHER, ProjectRole.REVIEWER),
    (Role.RESEARCHER, ProjectRole.VIEWER),
    (Role.RESEARCHER, None),
    (Role.REVIEWER, ProjectRole.REVIEWER),
    (Role.REVIEWER, ProjectRole.VIEWER),
    (Role.REVIEWER, None),
]


def status_of(result: Any) -> int:
    return result if isinstance(result, int) else result.status_code


@pytest.mark.parametrize(("workspace_role", "project_role"), ROLES)
@pytest.mark.parametrize("operation", sorted(OPERATIONS))
def test_every_project_endpoint_follows_the_project_role(
    api: ApiAs,
    database: str,
    operation: str,
    workspace_role: Role,
    project_role: ProjectRole | None,
) -> None:
    setup = make_setup(api, database, workspace_role, project_role)
    step = OPERATIONS[operation]
    status = status_of(step.call(api(setup.subject), setup))
    assert status == step.expect(setup, project_role)


def test_a_reviewer_never_sees_another_projects_slides(api: ApiAs, database: str) -> None:
    setup = make_setup(api, database, Role.REVIEWER, ProjectRole.VIEWER)
    other = make_project(database, setup.tenant_id)
    join_project(database, other, setup.lead, "owner")
    hidden = api(setup.lead).post("/api/cases", json={"project_id": str(other), "label": "H-1"})
    hidden_id = hidden.json()["id"]
    client = api(setup.subject)
    assert client.get(f"/api/cases/{hidden_id}").status_code == 404
    assert client.get(f"/api/projects/{other}").status_code == 404
    assert {row["id"] for row in client.get("/api/cases").json()} == {setup.case}
    by_project = client.get("/api/cases", params={"project_id": str(other)}).json()
    assert by_project == []


def test_an_owner_cannot_become_a_workspace_reviewer(api: ApiAs, database: str) -> None:
    setup = make_setup(api, database, Role.RESEARCHER, ProjectRole.OWNER)
    admin = person(database, setup.tenant_id, "admin", Role.RESEARCHER, admin_rights=True)
    path = f"/api/tenant/members/{setup.subject.user_id}/role"
    refused = api(admin).put(path, json={"role": "reviewer"})
    assert (refused.status_code, refused.json()["code"]) == (409, "owns-projects")
    api(setup.lead).put(
        f"/api/projects/{setup.project}/members/{setup.subject.user_id}", json={"role": "viewer"}
    )
    assert api(admin).put(path, json={"role": "reviewer"}).status_code == 200


def test_leaving_the_workspace_leaves_its_projects(database: str, api: ApiAs) -> None:
    setup = make_setup(api, database, Role.RESEARCHER, ProjectRole.VIEWER)
    owner(database, f"DELETE FROM memberships WHERE user_id = '{setup.subject.user_id}'")
    rows = owner(
        database, f"SELECT count(*) FROM project_members WHERE user_id = '{setup.subject.user_id}'"
    )
    assert rows == [(0,)]
