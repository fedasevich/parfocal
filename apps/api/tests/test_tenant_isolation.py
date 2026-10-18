import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum, auto

import pytest
from case_support import seed_case
from db_support import APP_URL, OWNER_URL, ApiAs, query, with_database
from sqlalchemy import func, insert, select, text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from parfocal_api.openapi import openapi_schema
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import (
    Role,
    annotation_versions,
    annotations,
    api_tokens,
    audit_events,
    audit_people,
    case_requests,
    class_mappings,
    emergency_grants,
    invitations,
    job_steps,
    job_units,
    jobs,
    memberships,
    notification_preferences,
    notifications,
    organisations,
    platform_operators,
    project_classes,
    project_members,
    result_chunks,
    result_objects,
    result_set_classes,
    result_sets,
    review_assignments,
    review_task_slides,
    review_tasks,
    service_accounts,
    session_policies,
    slide_counters,
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
    "review_tasks",
    "review_task_slides",
    "review_assignments",
    "result_sets",
    "result_set_classes",
    "result_objects",
    "result_chunks",
    "annotations",
    "annotation_versions",
    "slide_counters",
    "jobs",
    "job_steps",
    "job_units",
    "notification_preferences",
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


async def seed_notifications(connection: AsyncConnection, seeded: Seeded) -> None:
    target = uuid.uuid4()
    await connection.execute(
        insert(notifications).values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            kind="mention",
            target_type="task",
            target_id=target,
            in_app=True,
            realtime=True,
            email_status="none",
        )
    )
    await connection.execute(
        insert(notification_preferences).values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            kind="reply",
            in_app=True,
            email=False,
            realtime=True,
        )
    )
    seeded.markers.add(str(target))


async def seed_cases(connection: AsyncConnection, seeded: Seeded) -> None:
    case = await seed_case(connection, seeded.tenant_id)
    seeded.ids["case"] = case.case_id
    seeded.ids["project"] = case.project_id
    job_id = await connection.scalar(
        insert(jobs)
        .values(tenant_id=seeded.tenant_id, project_id=case.project_id, kind="isolation-seed")
        .returning(jobs.c.id)
    )
    assert isinstance(job_id, uuid.UUID)
    await connection.execute(
        insert(job_steps).values(tenant_id=seeded.tenant_id, job_id=job_id, ordinal=0, name="scan")
    )
    await connection.execute(
        insert(job_units).values(
            tenant_id=seeded.tenant_id, job_id=job_id, ordinal=0, unit=0, worker="seed"
        )
    )
    seeded.ids["job"] = job_id
    seeded.markers.add(str(job_id))
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
    annotation_id = await connection.scalar(
        insert(annotations)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            slide_id=case.loose_slide_id,
            kind="roi",
            number=1,
            geometry=func.ST_GeomFromText("POLYGON((0 0,9 0,9 9,0 9,0 0))", 0),
            created_by_user_id=seeded.ids["user"],
        )
        .returning(annotations.c.id)
    )
    assert isinstance(annotation_id, uuid.UUID)
    await connection.execute(
        insert(annotation_versions).values(
            tenant_id=seeded.tenant_id,
            annotation_id=annotation_id,
            version=1,
            change="created",
            geometry=func.ST_GeomFromText("POLYGON((0 0,9 0,9 9,0 9,0 0))", 0),
            changed_by_user_id=seeded.ids["user"],
        )
    )
    await connection.execute(
        insert(slide_counters).values(
            tenant_id=seeded.tenant_id, slide_id=case.loose_slide_id, letter="R", last=1
        )
    )
    seeded.ids["slide"] = case.loose_slide_id
    set_name = f"Model {uuid.uuid4().hex[:8]}"
    set_id = await connection.scalar(
        insert(result_sets)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            slide_id=case.loose_slide_id,
            name=set_name,
            source="import",
        )
        .returning(result_sets.c.id)
    )
    assert isinstance(set_id, uuid.UUID)
    await connection.execute(
        insert(result_set_classes).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            result_set_id=set_id,
            position=0,
            source_name="tumor",
            class_id=class_id,
        )
    )
    await connection.execute(
        insert(result_objects).values(
            tenant_id=seeded.tenant_id,
            result_set_id=set_id,
            kind="region",
            number=1,
            geometry="SRID=0;POLYGON((0 0,9 0,9 9,0 9,0 0))",
        )
    )
    await connection.execute(
        insert(result_chunks).values(
            tenant_id=seeded.tenant_id,
            result_set_id=set_id,
            chunk=0,
            x=0,
            y=0,
            width=2048,
            height=2048,
            cell_count=1,
            vertex_count=16,
            object_key=f"cells/{set_id}/chunk-00000.pfc",
        )
    )
    seeded.ids["result_set"] = set_id
    task_name = f"Task {uuid.uuid4().hex[:8]}"
    task_id = await connection.scalar(
        insert(review_tasks)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            number=1,
            name=task_name,
            split="everyone",
            scope="all-regions",
            opinion_form_version=1,
            start_mode="guided",
        )
        .returning(review_tasks.c.id)
    )
    assert isinstance(task_id, uuid.UUID)
    await connection.execute(
        insert(review_task_slides).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            position=0,
            result_set_id=set_id,
        )
    )
    await connection.execute(
        insert(review_assignments).values(
            tenant_id=seeded.tenant_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            user_id=seeded.ids["user"],
        )
    )
    seeded.ids["task"] = task_id
    seeded.markers.update({str(task_id), task_name})
    seeded.markers.update({str(set_id), set_name})
    seeded.ids["annotation"] = annotation_id
    seeded.markers.add(str(annotation_id))


SEEDERS: dict[str, Seeder] = {
    "notifications": seed_notifications,
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
    "listNotificationPreferences": Route(
        Exposure.PUBLIC, lambda _: "/api/me/notification-preferences"
    ),
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
    "getProjectJob": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/jobs/{a.ids['job']}"
    ),
    "getCase": Route(Exposure.TENANT, lambda a: f"/api/cases/{a.ids['case']}"),
    "listCases": Route(Exposure.TENANT, lambda _: "/api/cases"),
    "listReviewTasks": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/review-tasks"
    ),
    "getReviewTask": Route(Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}"),
    "listSlideResultSets": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/result-sets"
    ),
    "listProjectResultSets": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/result-sets"
    ),
    "getResultSet": Route(Exposure.TENANT, lambda a: f"/api/result-sets/{a.ids['result_set']}"),
    "listAnnotations": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/annotations"
    ),
    "getAnnotation": Route(
        Exposure.TENANT,
        lambda a: f"/api/slides/{a.ids['slide']}/annotations/{a.ids['annotation']}",
    ),
    "listAnnotationHistory": Route(
        Exposure.TENANT,
        lambda a: f"/api/slides/{a.ids['slide']}/annotations/{a.ids['annotation']}/history",
    ),
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
