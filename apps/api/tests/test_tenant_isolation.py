import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum, auto

import pytest
from case_support import seed_case
from db_support import APP_URL, OWNER_URL, ApiAs, query, with_database
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from parfocal_api.openapi import openapi_schema
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import (
    Role,
    api_tokens,
    audit_events,
    audit_people,
    case_requests,
    class_mappings,
    emergency_grants,
    invitations,
    memberships,
    organisations,
    platform_operators,
    project_classes,
    project_members,
    service_accounts,
    session_policies,
    tenants,
    users,
)
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction

pytestmark = pytest.mark.db


@dataclass(frozen=True)
class Seeded:
    tenant_id: uuid.UUID
    subject: str
    ids: dict[str, uuid.UUID] = field(default_factory=dict[str, uuid.UUID])
    markers: set[str] = field(default_factory=set[str])

    def member(self, role: Role = Role.RESEARCHER) -> MemberPrincipal:
        return MemberPrincipal(self.subject, self.tenant_id, self.ids["user"], role)


type Seeder = Callable[[AsyncConnection, Seeded], Awaitable[None]]


class Exposure(Enum):
    PUBLIC = auto()
    PLATFORM = auto()
    TENANT = auto()


@dataclass(frozen=True)
class Route:
    exposure: Exposure
    path: Callable[[Seeded], str]
    role: Role = Role.RESEARCHER


BASE_TABLES = {"organisations", "tenants", "users", "memberships"}
CASE_TABLES = {
    "projects",
    "project_members",
    "opinion_forms",
    "project_classes",
    "class_mappings",
    "tenant_keys",
    "patients",
    "specimens",
    "blocks",
    "slides",
    "case_requests",
    "emergency_grants",
}
AUTH_TABLES = {"platform_operators", "auth_logins", "sessions"}


async def seed_audit_people(connection: AsyncConnection, seeded: Seeded) -> None:
    subject = await connection.scalar(
        select(users.c.subject).where(users.c.id == seeded.ids["user"])
    )
    pseudonym = await connection.scalar(
        insert(audit_people).values(subject=subject).returning(audit_people.c.id)
    )
    assert isinstance(pseudonym, uuid.UUID)
    seeded.ids["audit_person"] = pseudonym
    seeded.markers.add(str(subject))


async def seed_audit_events(connection: AsyncConnection, seeded: Seeded) -> None:
    marker = f"audit-{uuid.uuid4().hex}"
    await connection.execute(
        insert(audit_events).values(
            tenant_id=seeded.tenant_id,
            actor_kind="member",
            actor_id=seeded.ids["audit_person"],
            action="case.opened",
            target_type="case",
            details=f'{{"marker":"{marker}"}}',
        )
    )
    seeded.markers.add(marker)


async def seed_service_accounts(connection: AsyncConnection, seeded: Seeded) -> None:
    name = f"Service {uuid.uuid4().hex}"
    account = await connection.scalar(
        insert(service_accounts)
        .values(tenant_id=seeded.tenant_id, name=name, scopes=["see-people"])
        .returning(service_accounts.c.id)
    )
    assert isinstance(account, uuid.UUID)
    seeded.ids["service_account"] = account
    seeded.markers.update({name, str(account)})


async def seed_api_tokens(connection: AsyncConnection, seeded: Seeded) -> None:
    token = await connection.scalar(
        insert(api_tokens)
        .values(
            tenant_id=seeded.tenant_id,
            service_account_id=seeded.ids["service_account"],
            token_hash=uuid.uuid4().bytes,
            expires_at=text("now() + interval '1 day'"),
        )
        .returning(api_tokens.c.id)
    )
    seeded.markers.add(str(token))


async def seed_invitations(connection: AsyncConnection, seeded: Seeded) -> None:
    email = f"invited-{uuid.uuid4().hex[:12]}@example.test"
    await connection.execute(
        insert(invitations).values(
            tenant_id=seeded.tenant_id,
            email=email,
            role="researcher",
            token_hash=uuid.uuid4().bytes,
            expires_at=text("now() + interval '1 day'"),
        )
    )
    seeded.markers.add(email)


async def seed_session_policies(connection: AsyncConnection, seeded: Seeded) -> None:
    await connection.execute(
        insert(session_policies).values(
            tenant_id=seeded.tenant_id, idle_lock_minutes=20, session_hours=10
        )
    )


async def seed_cases(connection: AsyncConnection, seeded: Seeded) -> None:
    case = await seed_case(connection, seeded.tenant_id)
    seeded.ids["case"] = case.case_id
    seeded.ids["project"] = case.project_id
    class_name = f"Class {uuid.uuid4().hex[:8]}"
    class_id = await connection.scalar(
        insert(project_classes)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            key=1,
            name=class_name,
            colour="#f87171",
        )
        .returning(project_classes.c.id)
    )
    source = uuid.uuid4()
    source_name = str(source)
    await connection.execute(
        insert(class_mappings).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            source_name=source_name,
            class_id=class_id,
        )
    )
    assert isinstance(class_id, uuid.UUID)
    seeded.ids["source"] = source
    seeded.markers.update({class_name, source_name, str(class_id)})
    await connection.execute(
        insert(project_members).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            user_id=seeded.ids["user"],
            role="owner",
        )
    )
    await connection.execute(
        insert(case_requests).values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            request_key="isolation",
            case_id=case.case_id,
        )
    )
    await connection.execute(
        insert(emergency_grants).values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            project_id=case.project_id,
            reason="Isolation suite reason",
            expires_at=text("now() + interval '1 hour'"),
        )
    )
    seeded.markers.update({case.label, str(case.case_id), str(case.project_id)})


SEEDERS: dict[str, Seeder] = {
    "invitations": seed_invitations,
    "cases": seed_cases,
    "session_policies": seed_session_policies,
    "audit_people": seed_audit_people,
    "audit_events": seed_audit_events,
    "service_accounts": seed_service_accounts,
    "api_tokens": seed_api_tokens,
}
GET_ROUTES = {
    "getHealth": Route(Exposure.PUBLIC, lambda _: "/api/health"),
    "listOrganisations": Route(Exposure.PLATFORM, lambda _: "/api/platform/organisations"),
    "listTenants": Route(Exposure.PLATFORM, lambda _: "/api/platform/tenants"),
    "getTenant": Route(Exposure.PLATFORM, lambda a: f"/api/platform/tenants/{a.tenant_id}"),
    "getCurrentTenant": Route(Exposure.TENANT, lambda _: "/api/tenant"),
    "getSession": Route(Exposure.PUBLIC, lambda _: "/api/auth/session"),
    "getMe": Route(Exposure.TENANT, lambda _: "/api/me"),
    "listTenantMembers": Route(Exposure.TENANT, lambda _: "/api/tenant/members"),
    "listAuditEvents": Route(Exposure.TENANT, lambda _: "/api/tenant/audit-events", Role.ADMIN),
    "exportAuditEvents": Route(
        Exposure.TENANT, lambda _: "/api/tenant/audit-events/export", Role.ADMIN
    ),
    "listAuditSigningKeys": Route(
        Exposure.TENANT, lambda _: "/api/tenant/audit-events/signing-keys", Role.ADMIN
    ),
    "listServiceAccounts": Route(Exposure.TENANT, lambda _: "/api/tenant/service-accounts"),
    "listInvitations": Route(Exposure.TENANT, lambda _: "/api/tenant/invitations", Role.ADMIN),
    "getSessionPolicy": Route(Exposure.TENANT, lambda _: "/api/tenant/session-policy"),
    "listProjects": Route(Exposure.TENANT, lambda _: "/api/projects"),
    "getProject": Route(Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}"),
    "listTaxonomyTemplates": Route(Exposure.PUBLIC, lambda _: "/api/taxonomy-templates"),
    "getOpinionFormTemplate": Route(Exposure.PUBLIC, lambda _: "/api/opinion-form-template"),
    "getOpinionForm": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/opinion-form"
    ),
    "listOpinionFormVersions": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/opinion-form/versions"
    ),
    "getOpinionFormVersion": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/opinion-form/versions/1"
    ),
    "listProjectClasses": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/classes"
    ),
    "listClassMappings": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/class-mappings"
    ),
    "resolveClassNames": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['project']}/class-mappings/resolve?name={a.ids['source']}",
    ),
    "getCase": Route(Exposure.TENANT, lambda a: f"/api/cases/{a.ids['case']}"),
    "listCases": Route(Exposure.TENANT, lambda _: "/api/cases"),
    "getMyAvailability": Route(Exposure.TENANT, lambda _: "/api/me/availability"),
    "listAvailability": Route(Exposure.TENANT, lambda _: "/api/tenant/availability"),
    "listSessions": Route(Exposure.PUBLIC, lambda _: "/api/auth/sessions"),
    "listMembers": Route(
        Exposure.PLATFORM, lambda a: f"/api/platform/tenants/{a.tenant_id}/members"
    ),
}
UNOWNED_TABLES = {"alembic_version", "spatial_ref_sys"}


def routes(exposure: Exposure) -> list[str]:
    return [name for name, route in GET_ROUTES.items() if route.exposure is exposure]


async def seed_tenant(connection: AsyncConnection, label: str) -> Seeded:
    slug = f"{label}-{uuid.uuid4().hex[:10]}"
    name = f"Isolation {slug}"
    organisation_id = await connection.scalar(
        insert(organisations).values(slug=slug, name=name).returning(organisations.c.id)
    )
    tenant_id = await connection.scalar(
        insert(tenants)
        .values(
            organisation_id=organisation_id,
            slug=slug,
            name=name,
            kind="diagnostic",
            region="eu",
            plan="pilot",
        )
        .returning(tenants.c.id)
    )
    member_name = f"Member {slug}"
    user_id = await connection.scalar(
        insert(users)
        .values(
            subject=f"subject-{slug}",
            email=f"{slug}@example.test",
            display_name=member_name,
            initials="MM",
            avatar_colour=0,
        )
        .returning(users.c.id)
    )
    await connection.execute(
        insert(memberships).values(tenant_id=tenant_id, user_id=user_id, role="researcher")
    )
    assert isinstance(organisation_id, uuid.UUID)
    assert isinstance(tenant_id, uuid.UUID)
    assert isinstance(user_id, uuid.UUID)
    seeded = Seeded(
        tenant_id=tenant_id,
        subject=f"subject-{slug}",
        ids={"organisation": organisation_id, "tenant": tenant_id, "user": user_id},
        markers={str(organisation_id), str(tenant_id), str(user_id), slug, name, member_name},
    )
    for seeder in SEEDERS.values():
        await seeder(connection, seeded)
    return seeded


async def seed_both(database: str) -> tuple[Seeded, Seeded]:
    engine = create_async_engine(async_database_url(with_database(OWNER_URL, database)))
    try:
        async with engine.begin() as connection:
            return await seed_tenant(connection, "a"), await seed_tenant(connection, "b")
    finally:
        await engine.dispose()


@pytest.fixture(scope="module")
def seeded(database: str) -> tuple[Seeded, Seeded]:
    return asyncio.run(seed_both(database))


def test_every_get_operation_is_in_the_suite() -> None:
    paths: dict[str, dict[str, dict[str, str]]] = openapi_schema()["paths"]
    operations = {
        operation["operationId"]
        for path in paths.values()
        for method, operation in path.items()
        if method == "get"
    }
    assert operations == set(GET_ROUTES)


def test_every_table_is_seeded_by_the_suite(database: str) -> None:
    rows = query(
        with_database(OWNER_URL, database),
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    )
    known = BASE_TABLES | AUTH_TABLES | CASE_TABLES | set(SEEDERS)
    assert {str(row[0]) for row in rows} - UNOWNED_TABLES == known


@pytest.mark.parametrize("operation", routes(Exposure.TENANT))
def test_tenant_routes_show_a_member_their_own_data(
    api: ApiAs, seeded: tuple[Seeded, Seeded], operation: str
) -> None:
    a, _ = seeded
    route = GET_ROUTES[operation]
    response = api(a.member(route.role)).get(route.path(a))
    assert response.status_code == 200, response.text
    assert any(marker in response.text for marker in a.markers)


@pytest.mark.parametrize("operation", routes(Exposure.TENANT))
def test_tenant_routes_show_another_tenant_nothing(
    api: ApiAs, seeded: tuple[Seeded, Seeded], operation: str
) -> None:
    a, b = seeded
    route = GET_ROUTES[operation]
    response = api(b.member(route.role)).get(route.path(a))
    assert response.status_code in {200, 404}, response.text
    assert [marker for marker in a.markers if marker in response.text] == []


@pytest.mark.parametrize("operation", routes(Exposure.PLATFORM))
def test_platform_routes_refuse_members(
    api: ApiAs, seeded: tuple[Seeded, Seeded], operation: str
) -> None:
    a, b = seeded
    response = api(b.member()).get(GET_ROUTES[operation].path(a))
    assert response.status_code == 403
    assert [marker for marker in a.markers if marker in response.text] == []


async def rows_visible_to_a_member(database: str, tenant_id: uuid.UUID) -> dict[str, int]:
    owner = create_async_engine(async_database_url(with_database(OWNER_URL, database)))
    app = create_async_engine(async_database_url(with_database(APP_URL, database)))
    try:
        async with owner.begin() as connection:
            await connection.execute(
                insert(platform_operators).values(subject=f"operator-{uuid.uuid4()}")
            )
        counts: dict[str, int] = {}
        async with scoped_transaction(app, DatabaseScope(tenant_id=tenant_id)) as connection:
            for table in sorted(AUTH_TABLES):
                counts[table] = int(
                    await connection.scalar(text(f"SELECT count(*) FROM {table}")) or 0
                )
        return counts
    finally:
        await owner.dispose()
        await app.dispose()


def test_auth_tables_are_hidden_from_tenant_scopes(
    database: str, seeded: tuple[Seeded, Seeded]
) -> None:
    a, _ = seeded
    counts = asyncio.run(rows_visible_to_a_member(database, a.tenant_id))
    assert counts == dict.fromkeys(sorted(AUTH_TABLES), 0)
