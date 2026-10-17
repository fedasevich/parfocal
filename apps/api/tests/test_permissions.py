import asyncio
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pytest
from case_support import seed_case, seed_project
from db_support import OWNER_URL, ApiAs, with_database
from sqlalchemy import func, insert
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from parfocal_api.openapi import openapi_schema
from parfocal_api.permissions import (
    COLUMNS,
    MATRIX,
    Grant,
    Permission,
    grant_for,
)
from parfocal_api.permissions_doc import DOC_PATH, render
from parfocal_api.principals import MemberPrincipal, Principal, SignedInUser
from parfocal_api.tables import (
    Role,
    api_tokens,
    invitations,
    memberships,
    organisations,
    project_members,
    service_accounts,
    tenants,
    users,
)
from parfocal_common.db import async_database_url

OPEN_OPERATIONS = {
    "getHealth": "public",
    "getSession": "signed-in",
    "getMe": "signed-in",
    "updateMe": "signed-in",
    "switchWorkspace": "signed-in",
    "getCurrentTenant": "member",
    "createOrganisation": "platform",
    "listOrganisations": "platform",
    "createTenant": "platform",
    "listTenants": "platform",
    "getTenant": "platform",
    "suspendTenant": "platform",
    "reactivateTenant": "platform",
    "addMember": "platform",
    "invitePlatformMember": "platform",
    "acceptInvitation": "signed-in",
    "listSessions": "signed-in",
    "recordActivity": "signed-in",
    "endSession": "signed-in",
    "endOtherSessions": "signed-in",
    "getSessionPolicy": "member",
    "getMyAvailability": "member",
    "setMyAvailability": "member",
    "listMembers": "platform",
}


@dataclass(frozen=True)
class Workspace:
    tenant_id: uuid.UUID
    users: dict[Role, uuid.UUID]
    colleague: uuid.UUID
    slug: str
    account: uuid.UUID
    token: uuid.UUID
    spare_account: uuid.UUID
    invitations: list[uuid.UUID]
    case: uuid.UUID
    project: uuid.UUID
    spare_project: uuid.UUID
    outside_project: uuid.UUID


@dataclass(frozen=True)
class Call:
    method: str
    path: str
    body: dict[str, Any] | None = None


GUARDED_CALLS: dict[str, Callable[[Workspace], Call]] = {
    "createProject": lambda _: Call("POST", "/api/projects", {"name": "Matrix project"}),
    "listProjects": lambda _: Call("GET", "/api/projects"),
    "getProject": lambda w: Call("GET", f"/api/projects/{w.project}"),
    "updateProject": lambda w: Call("PATCH", f"/api/projects/{w.project}", {"colour": 3}),
    "archiveProject": lambda w: Call("POST", f"/api/projects/{w.spare_project}/archive"),
    "restoreProject": lambda w: Call("POST", f"/api/projects/{w.spare_project}/restore"),
    "setProjectMember": lambda w: Call(
        "PUT", f"/api/projects/{w.project}/members/{w.colleague}", {"role": "viewer"}
    ),
    "removeProjectMember": lambda w: Call(
        "DELETE", f"/api/projects/{w.project}/members/{w.colleague}"
    ),
    "getCase": lambda w: Call("GET", f"/api/cases/{w.case}"),
    "requestEmergencyAccess": lambda w: Call(
        "POST",
        f"/api/projects/{w.outside_project}/emergency-access",
        {"reason": "Matrix check of access"},
    ),
    "listCases": lambda _: Call("GET", "/api/cases"),
    "createCase": lambda w: Call(
        "POST",
        "/api/cases",
        {
            "project_id": str(w.project),
            "label": f"PM-{uuid.uuid4().hex[:8]}",
            "patient": {"name": "Matrix Patient"},
            "specimens": [{"letter": "A"}],
        },
    ),
    "listAvailability": lambda _: Call("GET", "/api/tenant/availability"),
    "updateSessionPolicy": lambda _: Call(
        "PUT", "/api/tenant/session-policy", {"idle_lock_minutes": 15, "session_hours": 12}
    ),
    "listInvitations": lambda _: Call("GET", "/api/tenant/invitations"),
    "createInvitation": lambda _: Call(
        "POST",
        "/api/tenant/invitations",
        {"email": f"{uuid.uuid4().hex[:8]}@example.test", "role": "researcher"},
    ),
    "revokeInvitation": lambda w: Call("DELETE", f"/api/tenant/invitations/{w.invitations.pop()}"),
    "listServiceAccounts": lambda _: Call("GET", "/api/tenant/service-accounts"),
    "createServiceAccount": lambda _: Call(
        "POST",
        "/api/tenant/service-accounts",
        {"name": f"LIS {uuid.uuid4().hex[:8]}", "scopes": ["create-cases"]},
    ),
    "issueApiToken": lambda w: Call("POST", f"/api/tenant/service-accounts/{w.account}/tokens", {}),
    "revokeApiToken": lambda w: Call(
        "DELETE", f"/api/tenant/service-accounts/{w.account}/tokens/{w.token}"
    ),
    "disableServiceAccount": lambda w: Call(
        "POST", f"/api/tenant/service-accounts/{w.spare_account}/disable"
    ),
    "listAuditEvents": lambda _: Call("GET", "/api/tenant/audit-events"),
    "listTenantMembers": lambda _: Call("GET", "/api/tenant/members"),
    "changeMemberRole": lambda w: Call(
        "PUT", f"/api/tenant/members/{w.colleague}/role", {"role": "reviewer"}
    ),
}
PLACEHOLDER = Workspace(
    uuid.uuid4(),
    {},
    uuid.uuid4(),
    "",
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    [uuid.uuid4()],
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
)
MEMBER_CALLS: dict[str, Callable[[Workspace], Call]] = {
    "getCurrentTenant": lambda _: Call("GET", "/api/tenant"),
    "getSessionPolicy": lambda _: Call("GET", "/api/tenant/session-policy"),
    "getMyAvailability": lambda _: Call("GET", "/api/me/availability"),
    "setMyAvailability": lambda _: Call("PUT", "/api/me/availability", {"status": "available"}),
}


def operations() -> dict[str, dict[str, Any]]:
    schema = openapi_schema()
    return {
        operation["operationId"]: operation
        for path in schema["paths"].values()
        for operation in path.values()
    }


def guarded_operations() -> dict[str, Permission]:
    return {
        name: Permission(operation["x-permission"])
        for name, operation in operations().items()
        if "x-permission" in operation
    }


WRITES = {name for name, call in GUARDED_CALLS.items() if call(PLACEHOLDER).method != "GET"}


def writes() -> set[str]:
    return {name for name, operation in operations().items() if operation.get("x-permission-write")}


def test_the_matrix_covers_every_permission_for_every_role() -> None:
    assert set(COLUMNS) == set(Role)
    assert set(MATRIX) == set(Permission)
    for grants in MATRIX.values():
        assert set(grants) == set(Role)


def test_administrators_reach_patients_only_through_emergency_access() -> None:
    assert grant_for(Role.ADMIN, Permission.SEE_SLIDES) is Grant.NONE
    assert grant_for(Role.ADMIN, Permission.EMERGENCY_ACCESS) is Grant.EMERGENCY
    assert set(Grant) == {Grant.ALL, Grant.ASSIGNED, Grant.VIEW_ONLY, Grant.EMERGENCY, Grant.NONE}


def test_the_permission_page_is_current() -> None:
    assert Path(DOC_PATH).read_text() == render()


def test_every_operation_declares_a_permission_or_why_it_is_open() -> None:
    every = operations()
    guarded = guarded_operations()
    assert set(every) == set(guarded) | set(OPEN_OPERATIONS)
    assert not set(guarded) & set(OPEN_OPERATIONS)
    assert set(guarded) == set(GUARDED_CALLS)
    assert writes() == WRITES
    member_open = {name for name, reason in OPEN_OPERATIONS.items() if reason == "member"}
    assert member_open == set(MEMBER_CALLS)


async def add_person(
    connection: AsyncConnection, tenant_id: uuid.UUID, subject: str, role: Role
) -> uuid.UUID:
    user_id = await connection.scalar(
        insert(users)
        .values(subject=subject, display_name=subject, initials="PP", avatar_colour=1)
        .returning(users.c.id)
    )
    assert isinstance(user_id, uuid.UUID)
    await connection.execute(
        insert(memberships).values(tenant_id=tenant_id, user_id=user_id, role=role)
    )
    return user_id


async def seed(database: str) -> Workspace:
    engine = create_async_engine(async_database_url(with_database(OWNER_URL, database)))
    slug = f"perm-{uuid.uuid4().hex[:10]}"
    try:
        async with engine.begin() as connection:
            organisation_id = await connection.scalar(
                insert(organisations).values(slug=slug, name=slug).returning(organisations.c.id)
            )
            tenant_id = await connection.scalar(
                insert(tenants)
                .values(
                    organisation_id=organisation_id,
                    slug=slug,
                    name=slug,
                    kind="diagnostic",
                    region="eu",
                    plan="pilot",
                )
                .returning(tenants.c.id)
            )
            assert isinstance(tenant_id, uuid.UUID)
            people = {
                role: await add_person(connection, tenant_id, f"{slug}-{role}", role)
                for role in COLUMNS
            }
            colleague = await add_person(connection, tenant_id, f"{slug}-colleague", Role.REVIEWER)
            account, spare_account = [
                await connection.scalar(
                    insert(service_accounts)
                    .values(tenant_id=tenant_id, name=name, scopes=["create-cases"])
                    .returning(service_accounts.c.id)
                )
                for name in ("Permission check", "Spare")
            ]
            token = await connection.scalar(
                insert(api_tokens)
                .values(
                    tenant_id=tenant_id,
                    service_account_id=account,
                    token_hash=uuid.uuid4().bytes,
                    expires_at=func.now(),
                )
                .returning(api_tokens.c.id)
            )
            pending = [
                await connection.scalar(
                    insert(invitations)
                    .values(
                        tenant_id=tenant_id,
                        email=f"pending-{index}@example.test",
                        role="researcher",
                        token_hash=uuid.uuid4().bytes,
                        expires_at=func.now(),
                    )
                    .returning(invitations.c.id)
                )
                for index in range(len(COLUMNS))
            ]
            case = await seed_case(connection, tenant_id)
            spare_project = await seed_project(connection, tenant_id)
            outside_project = await seed_project(connection, tenant_id)
            await connection.execute(
                insert(project_members),
                [
                    {
                        "tenant_id": tenant_id,
                        "project_id": project,
                        "user_id": people[Role.RESEARCHER],
                        "role": "owner",
                    }
                    for project in (case.project_id, spare_project)
                ]
                + [
                    {
                        "tenant_id": tenant_id,
                        "project_id": case.project_id,
                        "user_id": user,
                        "role": role,
                    }
                    for user, role in ((people[Role.REVIEWER], "viewer"), (colleague, "viewer"))
                ],
            )
        assert isinstance(tenant_id, uuid.UUID)
        assert isinstance(account, uuid.UUID)
        assert isinstance(token, uuid.UUID)
        assert isinstance(spare_account, uuid.UUID)
        ids = [invitation for invitation in pending if isinstance(invitation, uuid.UUID)]
        return Workspace(
            tenant_id,
            people,
            colleague,
            slug,
            account,
            token,
            spare_account,
            ids,
            case.case_id,
            case.project_id,
            spare_project,
            outside_project,
        )
    finally:
        await engine.dispose()


@pytest.fixture(scope="module")
def workspace(database: str) -> Workspace:
    return asyncio.run(seed(database))


def principal_for(workspace: Workspace, role: Role) -> Principal:
    subject = f"{workspace.slug}-{role}"
    return MemberPrincipal(subject, workspace.tenant_id, workspace.users[role], role)


def send(api: ApiAs, principal: Principal, call: Call) -> int:
    response = api(principal).request(call.method, call.path, json=call.body)
    return response.status_code


GUARDED_CASES = [(operation, role) for operation in sorted(GUARDED_CALLS) for role in COLUMNS]


@pytest.mark.db
@pytest.mark.parametrize(("operation", "role"), GUARDED_CASES)
def test_every_guarded_endpoint_follows_the_matrix_for_every_role(
    api: ApiAs, workspace: Workspace, operation: str, role: Role
) -> None:
    permission = guarded_operations()[operation]
    status = send(api, principal_for(workspace, role), GUARDED_CALLS[operation](workspace))
    grant = grant_for(role, permission)
    if grant is Grant.NONE or (operation in WRITES and grant is Grant.VIEW_ONLY):
        assert status == 403
    else:
        assert 200 <= status < 300


@pytest.mark.db
@pytest.mark.parametrize(
    ("operation", "role"), [(name, role) for name in sorted(MEMBER_CALLS) for role in COLUMNS]
)
def test_every_member_endpoint_is_open_to_every_member_role(
    api: ApiAs, workspace: Workspace, operation: str, role: Role
) -> None:
    assert send(api, principal_for(workspace, role), MEMBER_CALLS[operation](workspace)) == 200


@pytest.mark.db
def test_nobody_changes_their_own_role(api: ApiAs, workspace: Workspace) -> None:
    admin = principal_for(workspace, Role.ADMIN)
    response = api(admin).put(
        f"/api/tenant/members/{workspace.users[Role.ADMIN]}/role", json={"role": "reviewer"}
    )
    assert (response.status_code, response.json()["code"]) == (409, "own-role")


@pytest.mark.db
def test_a_role_change_takes_effect_and_rejects_unknown_roles(
    api: ApiAs, workspace: Workspace
) -> None:
    admin = principal_for(workspace, Role.ADMIN)
    path = f"/api/tenant/members/{workspace.colleague}/role"
    changed = api(admin).put(path, json={"role": "researcher"})
    assert (changed.status_code, changed.json()["role"]) == (200, "researcher")
    assert api(admin).put(path, json={"role": "outside-consultant"}).status_code == 422
    unknown = api(admin).put(
        f"/api/tenant/members/{uuid.uuid4()}/role", json={"role": "researcher"}
    )
    assert unknown.status_code == 404
    api(admin).put(path, json={"role": "reviewer"})


WORKSPACE_CALLS = GUARDED_CALLS | MEMBER_CALLS


@pytest.mark.db
@pytest.mark.parametrize("operation", sorted(WORKSPACE_CALLS))
def test_workspace_routes_refuse_people_without_a_membership(api: ApiAs, operation: str) -> None:
    outsider = SignedInUser("outsider", uuid.uuid4())
    placeholder = replace(PLACEHOLDER, invitations=[uuid.uuid4()])
    assert send(api, outsider, WORKSPACE_CALLS[operation](placeholder)) == 403
