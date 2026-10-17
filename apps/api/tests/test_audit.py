import asyncio
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from db_support import APP_URL, OWNER_URL, ApiAs, query, with_database
from idp_support import Browser
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from parfocal_api.audit import (
    Actor,
    AuditAction,
    AuditEvent,
    AuditTarget,
    actor_of,
    chain_breaks,
    forget,
    record,
)
from parfocal_api.principals import MemberPrincipal, PlatformOperator, ServicePrincipal
from parfocal_api.tables import ActorKind, Role
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction

pytestmark = pytest.mark.db

OPERATOR = PlatformOperator("audit-operator")
SYSTEM = Actor(ActorKind.SYSTEM)


def owner_sql(database: str, statement: str) -> list[tuple[object, ...]]:
    return query(with_database(OWNER_URL, database), statement)


def behind_the_trigger(database: str, statement: str) -> None:
    owner_sql(database, "ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only")
    try:
        owner_sql(database, statement)
    finally:
        owner_sql(database, "ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only")


def make_tenant(api: ApiAs) -> str:
    slug = f"audit-{uuid.uuid4().hex[:10]}"
    organisation = api(OPERATOR).post(
        "/api/platform/organisations", json={"slug": slug, "name": slug}
    )
    tenant = api(OPERATOR).post(
        "/api/platform/tenants",
        json={
            "organisation_id": organisation.json()["id"],
            "slug": slug,
            "name": slug,
            "kind": "diagnostic",
            "region": "eu",
        },
    )
    return str(tenant.json()["id"])


def make_user(database: str, label: str) -> str:
    rows = owner_sql(
        database,
        "INSERT INTO users (subject, display_name, initials, avatar_colour) "
        f"VALUES ('{label}-{uuid.uuid4().hex[:8]}', 'Audit person', 'AP', 3) RETURNING id",
    )
    return str(rows[0][0])


def subject_of(database: str, user_id: str) -> str:
    return str(owner_sql(database, f"SELECT subject FROM users WHERE id = '{user_id}'")[0][0])


def add_member(api: ApiAs, tenant_id: str, user_id: str, role: str) -> None:
    response = api(OPERATOR).post(
        f"/api/platform/tenants/{tenant_id}/members", json={"user_id": user_id, "role": role}
    )
    assert response.status_code == 201


def admin_of(api: ApiAs, database: str, tenant_id: str) -> MemberPrincipal:
    admin = make_user(database, "admin")
    add_member(api, tenant_id, admin, "admin")
    subject = subject_of(database, admin)
    return MemberPrincipal(subject, uuid.UUID(tenant_id), uuid.UUID(admin), Role.ADMIN)


def trail(api: ApiAs, admin: MemberPrincipal, **filters: str) -> list[AuditEvent]:
    response = api(admin).get("/api/tenant/audit-events", params=filters)
    assert response.status_code == 200, response.text
    return [AuditEvent.model_validate(event) for event in response.json()]


async def in_scope(
    database: str, scope: DatabaseScope, work: Callable[[AsyncConnection], Awaitable[Any]]
) -> Any:
    engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
    try:
        async with scoped_transaction(engine, scope) as connection:
            return await work(connection)
    finally:
        await engine.dispose()


def test_platform_and_member_actions_form_a_verified_chain(api: ApiAs, database: str) -> None:
    tenant_id = make_tenant(api)
    admin = admin_of(api, database, tenant_id)
    colleague = make_user(database, "colleague")
    add_member(api, tenant_id, colleague, "reviewer")
    api(OPERATOR).post(f"/api/platform/tenants/{tenant_id}/suspend")
    api(OPERATOR).post(f"/api/platform/tenants/{tenant_id}/reactivate")
    path = f"/api/tenant/members/{colleague}/role"
    assert api(admin).put(path, json={"role": "researcher"}).status_code == 200
    assert api(admin).put(path, json={"role": "researcher"}).status_code == 200

    events = trail(api, admin)
    assert [event.action for event in events] == [
        AuditAction.TENANT_CREATED,
        AuditAction.MEMBER_ADDED,
        AuditAction.MEMBER_ADDED,
        AuditAction.TENANT_SUSPENDED,
        AuditAction.TENANT_REACTIVATED,
        AuditAction.MEMBER_ROLE_CHANGED,
    ]
    assert [event.seq for event in events] == list(range(1, 7))
    assert chain_breaks(events) == []
    changed = events[-1]
    assert (changed.actor_kind, changed.actor_subject) == (ActorKind.MEMBER, admin.subject)
    assert (changed.target_subject, changed.details) == (
        subject_of(database, colleague),
        '{"from":"reviewer","to":"researcher"}',
    )
    assert events[0].actor_kind is ActorKind.OPERATOR


def test_the_app_role_cannot_change_or_remove_entries(api: ApiAs, database: str) -> None:
    tenant_id = make_tenant(api)
    scope = DatabaseScope(tenant_id=uuid.UUID(tenant_id))
    for statement in (
        "UPDATE audit_events SET details = '{}'",
        "DELETE FROM audit_events",
        "TRUNCATE audit_events",
    ):
        with pytest.raises(DBAPIError, match="permission denied"):
            asyncio.run(in_scope(database, scope, lambda c, s=statement: c.execute(text(s))))
    count = f"SELECT count(*) FROM audit_events WHERE tenant_id = '{tenant_id}'"
    assert owner_sql(database, count) == [(1,)]


def test_even_the_owner_cannot_change_entries_while_the_trigger_stands(
    api: ApiAs, database: str
) -> None:
    tenant_id = make_tenant(api)
    for statement in (
        f"UPDATE audit_events SET details = '{{}}' WHERE tenant_id = '{tenant_id}'",
        f"DELETE FROM audit_events WHERE tenant_id = '{tenant_id}'",
    ):
        with pytest.raises(DBAPIError, match="append-only"):
            owner_sql(database, statement)


def test_a_changed_entry_breaks_the_chain(api: ApiAs, database: str) -> None:
    tenant_id = make_tenant(api)
    admin = admin_of(api, database, tenant_id)
    add_member(api, tenant_id, make_user(database, "other"), "researcher")
    assert chain_breaks(trail(api, admin)) == []
    behind_the_trigger(
        database,
        'UPDATE audit_events SET details = \'{"role":"admin"}\' '
        f"WHERE tenant_id = '{tenant_id}' AND seq = 3",
    )
    assert chain_breaks(trail(api, admin)) == [3]


def test_a_removed_entry_breaks_the_chain(api: ApiAs, database: str) -> None:
    tenant_id = make_tenant(api)
    admin = admin_of(api, database, tenant_id)
    add_member(api, tenant_id, make_user(database, "other"), "researcher")
    behind_the_trigger(
        database, f"DELETE FROM audit_events WHERE tenant_id = '{tenant_id}' AND seq = 2"
    )
    assert chain_breaks(trail(api, admin)) == [3]


def test_concurrent_writers_keep_one_unbroken_chain(api: ApiAs, database: str) -> None:
    tenant_id = make_tenant(api)
    admin = admin_of(api, database, tenant_id)
    scope = DatabaseScope(tenant_id=uuid.UUID(tenant_id))

    async def write_many() -> None:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))

        async def one(index: int) -> None:
            async with scoped_transaction(engine, scope) as connection:
                await record(
                    connection,
                    SYSTEM,
                    AuditAction.MEMBER_ROLE_CHANGED,
                    AuditTarget.CASE,
                    tenant_id=uuid.UUID(tenant_id),
                    details={"index": index},
                )

        try:
            await asyncio.gather(*(one(index) for index in range(20)))
        finally:
            await engine.dispose()

    asyncio.run(write_many())
    events = trail(api, admin)
    assert [event.seq for event in events] == list(range(1, len(events) + 1))
    assert len(events) == 22
    assert chain_breaks(events) == []


def test_the_export_lists_a_case_history_in_order(api: ApiAs, database: str) -> None:
    tenant_id = make_tenant(api)
    admin = admin_of(api, database, tenant_id)
    case_id, other_case = uuid.uuid4(), uuid.uuid4()
    scope = DatabaseScope(tenant_id=uuid.UUID(tenant_id))
    steps = [
        (case_id, AuditAction.CASE_OPENED),
        (other_case, AuditAction.CASE_OPENED),
        (case_id, AuditAction.CASE_CREATED),
        (case_id, AuditAction.PROJECT_EMERGENCY_ACCESS),
    ]

    async def write(connection: AsyncConnection) -> None:
        for target, action in steps:
            await record(
                connection,
                Actor(ActorKind.MEMBER, admin.subject),
                action,
                AuditTarget.CASE,
                target,
                tenant_id=uuid.UUID(tenant_id),
            )

    asyncio.run(in_scope(database, scope, write))
    history = trail(api, admin, target_type="case", target_id=str(case_id))
    assert [event.action for event in history] == [
        AuditAction.CASE_OPENED,
        AuditAction.CASE_CREATED,
        AuditAction.PROJECT_EMERGENCY_ACCESS,
    ]
    assert {event.target_id for event in history} == {case_id}
    assert [event.seq for event in history] == sorted(event.seq for event in history)
    assert chain_breaks(trail(api, admin)) == []


def test_only_admins_read_the_trail(api: ApiAs, database: str) -> None:
    tenant_id = make_tenant(api)
    for role in ("researcher", "reviewer"):
        user = make_user(database, role)
        add_member(api, tenant_id, user, role)
        member = MemberPrincipal(role, uuid.UUID(tenant_id), uuid.UUID(user), Role(role))
        status = api(member).get("/api/tenant/audit-events").status_code
        assert status == 403


def test_sign_in_and_sign_out_are_recorded_on_the_platform_chain(
    browser: Browser, database: str
) -> None:
    browser.login()
    browser.client.get("/api/auth/logout")
    subject = browser.idp.subject
    rows = owner_sql(
        database,
        "SELECT action, tenant_id, actor_id = target_id FROM audit_events "
        "JOIN audit_people ON audit_people.id = audit_events.actor_id "
        f"WHERE audit_people.subject = '{subject}' ORDER BY seq",
    )
    assert rows == [("user.signed-in", None, True), ("user.signed-out", None, True)]


def test_entries_name_people_only_by_pseudonym(api: ApiAs, database: str) -> None:
    tenant_id = make_tenant(api)
    admin_of(api, database, tenant_id)
    columns = owner_sql(
        database,
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_events'",
    )
    assert {str(row[0]) for row in columns} == {
        "id",
        "tenant_id",
        "seq",
        "occurred_at",
        "actor_kind",
        "actor_id",
        "action",
        "target_type",
        "target_id",
        "details",
        "prev_hash",
        "hash",
    }
    entries = owner_sql(
        database, f"SELECT audit_events::text FROM audit_events WHERE tenant_id = '{tenant_id}'"
    )
    subjects = [str(row[0]) for row in owner_sql(database, "SELECT subject FROM users")]
    assert [s for s in subjects for entry in entries if s in str(entry[0])] == []


def test_forgetting_a_person_keeps_the_chain_and_drops_who_they_were(
    api: ApiAs, database: str
) -> None:
    tenant_id = make_tenant(api)
    admin = admin_of(api, database, tenant_id)
    leaver = make_user(database, "leaver")
    add_member(api, tenant_id, leaver, "reviewer")
    leaver_subject = subject_of(database, leaver)
    api(admin).put(f"/api/tenant/members/{leaver}/role", json={"role": "researcher"})
    before = trail(api, admin)
    assert {event.target_subject for event in before[-2:]} == {leaver_subject}

    async def forget_leaver(connection: AsyncConnection) -> bool:
        return await forget(connection, leaver_subject)

    assert asyncio.run(in_scope(database, DatabaseScope(platform=True), forget_leaver))
    after = trail(api, admin)
    assert chain_breaks(after) == []
    assert [event.hash for event in after] == [event.hash for event in before]
    assert {event.target_subject for event in after[-2:]} == {None}
    assert after[-1].target_id == before[-1].target_id


def test_only_the_platform_forgets_people(api: ApiAs, database: str) -> None:
    tenant_id = make_tenant(api)
    admin = admin_of(api, database, tenant_id)

    async def forget_admin(connection: AsyncConnection) -> bool:
        return await forget(connection, admin.subject)

    member_scope = DatabaseScope(tenant_id=uuid.UUID(tenant_id), user_id=admin.user_id)
    assert not asyncio.run(in_scope(database, member_scope, forget_admin))
    assert trail(api, admin)[-1].target_subject == admin.subject
    assert owner_sql(
        database, f"SELECT count(*) FROM audit_people WHERE subject = '{admin.subject}'"
    ) == [(1,)]


def test_a_workspace_cannot_resolve_people_from_another(api: ApiAs, database: str) -> None:
    mine, theirs = make_tenant(api), make_tenant(api)
    me = admin_of(api, database, mine)
    stranger = admin_of(api, database, theirs)
    scope = DatabaseScope(tenant_id=me.tenant_id, user_id=me.user_id)

    async def visible(connection: AsyncConnection) -> list[str]:
        rows = await connection.execute(text("SELECT subject FROM audit_people"))
        return [str(row[0]) for row in rows]

    seen = asyncio.run(in_scope(database, scope, visible))
    assert me.subject in seen
    assert stranger.subject not in seen


def test_service_accounts_are_named_by_their_account_id(api: ApiAs, database: str) -> None:
    tenant_id = make_tenant(api)
    admin = admin_of(api, database, tenant_id)
    account_id = uuid.uuid4()
    service = ServicePrincipal(account_id, uuid.UUID(tenant_id), frozenset({"see-people"}))

    async def write(connection: AsyncConnection) -> None:
        await record(
            connection,
            actor_of(service),
            AuditAction.CASE_OPENED,
            AuditTarget.CASE,
            uuid.uuid4(),
            tenant_id=uuid.UUID(tenant_id),
        )

    asyncio.run(in_scope(database, DatabaseScope(tenant_id=uuid.UUID(tenant_id)), write))
    last = trail(api, admin)[-1]
    assert (last.actor_kind, last.actor_id, last.actor_subject) == (
        ActorKind.SERVICE,
        account_id,
        None,
    )
