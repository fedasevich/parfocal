import asyncio
import uuid
from collections.abc import Iterator

import pytest
from db_support import OWNER_URL, migrated_database, run_sql, with_database
from sqlalchemy import select
from test_showcase import RESULTS, EmptyStore

from parfocal_api.adjudications import list_my_adjudications
from parfocal_api.my_work import MyStatus, list_tasks_assigned_by_me, my_review_tasks
from parfocal_api.permissions import Grant, Permission, grant_for
from parfocal_api.principals import MemberPrincipal
from parfocal_api.showcase import WORKSPACES, seed
from parfocal_api.showcase_roles import (
    ROLE_ANNOTATE,
    ROLE_REVIEW,
    RoleEmail,
    UnknownRoleError,
    account_of,
    role_emails_of,
)
from parfocal_api.tables import Role, TaskKind, review_tasks
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction

pytestmark = pytest.mark.db

OWNER = "owner@example.test"
AGENT = "agent-walk@example.test"
ROLES = (
    "researcher=role-researcher@example.test, reviewer=role-reviewer-a@example.test;"
    "reviewer=role-reviewer-b@example.test,adjudicator=role-adjudicator@example.test,"
    "viewer=role-viewer@example.test,annotator=role-annotator@example.test"
)
SEEDED_ROLES = role_emails_of(ROLES)


def seed_once(url: str) -> None:
    asyncio.run(
        seed(
            url,
            EmptyStore(),  # type: ignore[arg-type]
            RESULTS,  # type: ignore[arg-type]
            OWNER,
            agent_emails=[AGENT],
            role_emails=SEEDED_ROLES,
        )
    )


@pytest.fixture(scope="module")
def seeded() -> Iterator[str]:
    with migrated_database() as name:
        url = with_database(OWNER_URL, name)
        seed_once(url)
        seed_once(url)
        yield url


def test_role_emails_pair_a_role_with_an_address() -> None:
    assert role_emails_of(" Viewer = Role-Viewer@X.test ,, ") == [
        RoleEmail("viewer", "role-viewer@x.test")
    ]
    assert role_emails_of("") == []
    with pytest.raises(UnknownRoleError):
        role_emails_of("pathologist=a@x.test")


def test_each_role_account_gets_a_readable_name_and_no_admin_rights() -> None:
    names = {entry.email: account_of(entry) for entry in SEEDED_ROLES}
    reviewer = names["role-reviewer-a@example.test"]
    assert (reviewer.name, reviewer.initials) == ("Reviewer A", "RA")
    assert not any(account.admin_rights for account in names.values())


async def seat_of(url: str, slug: str, email: str) -> MemberPrincipal:
    rows = await run_sql(
        url,
        "SELECT t.id, u.id, u.subject, m.role FROM users u "
        "JOIN memberships m ON m.user_id = u.id JOIN tenants t ON t.id = m.tenant_id "
        f"WHERE u.email = '{email}' AND t.slug = '{slug}'",
    )
    tenant_id, user_id, subject, role = rows[0]
    return MemberPrincipal(
        str(subject), uuid.UUID(str(tenant_id)), uuid.UUID(str(user_id)), Role(role), False
    )


async def project_roles(url: str, email: str) -> set[str]:
    rows = await run_sql(
        url,
        "SELECT DISTINCT pm.role FROM project_members pm JOIN users u ON u.id = pm.user_id "
        f"WHERE u.email = '{email}'",
    )
    return {str(row[0]) for row in rows}


async def open_tasks(url: str, person: MemberPrincipal) -> dict[str, tuple[MyStatus, str]]:
    engine = create_engine(url)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(tenant_id=person.tenant_id, user_id=person.user_id)
        ) as connection:
            tasks = await my_review_tasks(connection, person.user_id)
            rows = await connection.execute(
                select(review_tasks.c.id, review_tasks.c.kind).where(
                    review_tasks.c.id.in_([task.id for task in tasks])
                )
            )
            kinds = {row.id: row.kind for row in rows}
    finally:
        await engine.dispose()
    return {
        task.name: (task.status, str(kinds[task.id]))
        for task in tasks
        if task.next_slide_id is not None
    }


@pytest.mark.parametrize("slug", [workspace.slug for workspace in WORKSPACES])
async def test_both_reviewers_have_an_unsubmitted_review_slide(seeded: str, slug: str) -> None:
    for email in ("role-reviewer-a@example.test", "role-reviewer-b@example.test"):
        person = await seat_of(seeded, slug, email)
        tasks = await open_tasks(seeded, person)
        assert tasks[ROLE_REVIEW] == (MyStatus.NOT_STARTED, TaskKind.REVIEW.value)
        assert ROLE_ANNOTATE not in tasks


@pytest.mark.parametrize("slug", [workspace.slug for workspace in WORKSPACES])
async def test_the_annotate_expert_has_an_unchecked_annotate_slide(seeded: str, slug: str) -> None:
    person = await seat_of(seeded, slug, "role-annotator@example.test")
    tasks = await open_tasks(seeded, person)
    assert tasks == {ROLE_ANNOTATE: (MyStatus.NOT_STARTED, TaskKind.ANNOTATE.value)}


@pytest.mark.parametrize("slug", [workspace.slug for workspace in WORKSPACES])
async def test_the_adjudicator_has_an_undecided_object_and_the_agent_keeps_its_own(
    seeded: str, slug: str
) -> None:
    engine = create_engine(seeded)
    try:
        for email in ("role-adjudicator@example.test", AGENT):
            person = await seat_of(seeded, slug, email)
            async with scoped_transaction(
                engine, DatabaseScope(tenant_id=person.tenant_id, user_id=person.user_id)
            ) as connection:
                sent = await list_my_adjudications(person, connection)
            assert sent, email
            assert any(item.decided == 0 for item in sent), email
    finally:
        await engine.dispose()
    adjudicator = await seat_of(seeded, slug, "role-adjudicator@example.test")
    assert grant_for(adjudicator.role, Permission.REVIEW) is not Grant.NONE


@pytest.mark.parametrize("slug", [workspace.slug for workspace in WORKSPACES])
async def test_the_researcher_owns_tasks_with_open_disagreements(seeded: str, slug: str) -> None:
    person = await seat_of(seeded, slug, "role-researcher@example.test")
    engine = create_engine(seeded)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(tenant_id=person.tenant_id, user_id=person.user_id)
        ) as connection:
            assigned = await list_tasks_assigned_by_me(person, connection)
    finally:
        await engine.dispose()
    assert any(task.open_disagreements > 0 for task in assigned)


async def test_the_viewer_only_reads_and_every_role_sits_in_every_workspace(seeded: str) -> None:
    assert await project_roles(seeded, "role-viewer@example.test") == {"viewer"}
    assert await project_roles(seeded, "role-researcher@example.test") == {"owner"}
    for entry in SEEDED_ROLES:
        held = await run_sql(
            seeded,
            "SELECT t.slug FROM memberships m JOIN users u ON u.id = m.user_id "
            f"JOIN tenants t ON t.id = m.tenant_id WHERE u.email = '{entry.email}'",
        )
        assert sorted(str(row[0]) for row in held) == sorted(w.slug for w in WORKSPACES)
    viewer = await seat_of(seeded, WORKSPACES[0].slug, "role-viewer@example.test")
    assert await open_tasks(seeded, viewer) == {}
