import asyncio
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from db_support import OWNER_URL, ApiAs, with_database
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from parfocal_api.openapi import openapi_schema
from parfocal_api.permissions import (
    COLUMNS,
    FOLDER_SCOPED,
    MATRIX,
    MEMBER_ROLES,
    Grant,
    Permission,
    grant_for,
)
from parfocal_api.permissions_doc import DOC_PATH, render
from parfocal_api.principals import GuestGrant, GuestPrincipal, MemberPrincipal, Principal
from parfocal_api.tables import Role, memberships, organisations, tenants, users
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
    "listMembers": "platform",
}


@dataclass(frozen=True)
class Workspace:
    tenant_id: uuid.UUID
    users: dict[Role, uuid.UUID]
    colleague: uuid.UUID


@dataclass(frozen=True)
class Call:
    method: str
    path: str
    body: dict[str, Any] | None = None


GUARDED_CALLS: dict[str, Callable[[Workspace], Call]] = {
    "listTenantMembers": lambda _: Call("GET", "/api/tenant/members"),
    "changeMemberRole": lambda w: Call(
        "PUT", f"/api/tenant/members/{w.colleague}/role", {"role": "consultant"}
    ),
}
MEMBER_CALLS: dict[str, Callable[[Workspace], Call]] = {
    "getCurrentTenant": lambda _: Call("GET", "/api/tenant"),
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


def test_the_matrix_covers_every_permission_for_every_role() -> None:
    assert set(COLUMNS) == set(Role)
    assert set(MATRIX) == set(Permission)
    for grants in MATRIX.values():
        assert set(grants) == set(Role)


def test_outside_consultants_and_administrators_keep_their_limits() -> None:
    assert Role.OUTSIDE_CONSULTANT not in MEMBER_ROLES
    assert grant_for(Role.ADMIN, Permission.SEE_CASES) is Grant.NONE
    assert grant_for(Role.ADMIN, Permission.OPEN_OUTSIDE_FOLDERS) is Grant.EMERGENCY
    assert grant_for(Role.RESIDENT, Permission.SIGN_OUT) is Grant.NEEDS_CO_SIGN
    assert grant_for(Role.LAB, Permission.DRAFT_REPORTS) is Grant.NONE
    assert all(
        grant_for(Role.OUTSIDE_CONSULTANT, permission)
        in {Grant.NONE, Grant.SHARED, Grant.MEASURE_AND_COMMENT}
        for permission in Permission
    )
    assert len(FOLDER_SCOPED) == 10


def test_the_permission_page_is_current() -> None:
    assert Path(DOC_PATH).read_text() == render()


def test_every_operation_declares_a_permission_or_why_it_is_open() -> None:
    every = operations()
    guarded = guarded_operations()
    assert set(every) == set(guarded) | set(OPEN_OPERATIONS)
    assert not set(guarded) & set(OPEN_OPERATIONS)
    assert set(guarded) == set(GUARDED_CALLS)
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
                for role in MEMBER_ROLES
            }
            colleague = await add_person(connection, tenant_id, f"{slug}-colleague", Role.RESIDENT)
        assert isinstance(tenant_id, uuid.UUID)
        return Workspace(tenant_id, people, colleague)
    finally:
        await engine.dispose()


@pytest.fixture(scope="module")
def workspace(database: str) -> Workspace:
    return asyncio.run(seed(database))


def principal_for(workspace: Workspace, role: Role) -> Principal:
    if role is Role.OUTSIDE_CONSULTANT:
        return GuestPrincipal(
            "outside", GuestGrant(host_tenant_id=workspace.tenant_id, case_id=uuid.uuid4())
        )
    return MemberPrincipal(f"subject-{role}", workspace.tenant_id, workspace.users[role], role)


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
    if grant_for(role, permission) is Grant.NONE:
        assert status == 403
    else:
        assert status == 200


@pytest.mark.db
@pytest.mark.parametrize(
    ("operation", "role"), [(name, role) for name in sorted(MEMBER_CALLS) for role in MEMBER_ROLES]
)
def test_every_member_endpoint_is_open_to_every_member_role(
    api: ApiAs, workspace: Workspace, operation: str, role: Role
) -> None:
    assert send(api, principal_for(workspace, role), MEMBER_CALLS[operation](workspace)) == 200


@pytest.mark.db
def test_nobody_changes_their_own_role(api: ApiAs, workspace: Workspace) -> None:
    lead = principal_for(workspace, Role.LEAD)
    response = api(lead).put(
        f"/api/tenant/members/{workspace.users[Role.LEAD]}/role", json={"role": "consultant"}
    )
    assert (response.status_code, response.json()["code"]) == (409, "own-role")


@pytest.mark.db
def test_a_role_change_takes_effect_and_rejects_guest_roles(
    api: ApiAs, workspace: Workspace
) -> None:
    admin = principal_for(workspace, Role.ADMIN)
    path = f"/api/tenant/members/{workspace.colleague}/role"
    changed = api(admin).put(path, json={"role": "lab"})
    assert (changed.status_code, changed.json()["role"]) == (200, "lab")
    assert api(admin).put(path, json={"role": "outside-consultant"}).status_code == 422
    unknown = api(admin).put(f"/api/tenant/members/{uuid.uuid4()}/role", json={"role": "lab"})
    assert unknown.status_code == 404
    api(admin).put(path, json={"role": "resident"})
