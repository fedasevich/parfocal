import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from db_support import OWNER_URL, migrated_database, run_sql, with_database
from sqlalchemy import select

from parfocal_api.auth import sign_in_user
from parfocal_api.review_states import State, states_of, task_of
from parfocal_api.showcase import FIXTURES_MANIFEST, FORMAT_GALLERY, RESULT_FILES, WORKSPACES, seed
from parfocal_api.tables import (
    DecisionStyle,
    DecisionValue,
    PrivacyMode,
    ProjectRole,
    Role,
    review_tasks,
)
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.jobs import JobStatus
from parfocal_common.object_store import StorageError
from parfocal_common.result_imports import ResultFormat

pytestmark = pytest.mark.db

COUNTED = (
    "organisations",
    "tenants",
    "users",
    "memberships",
    "projects",
    "project_members",
    "slides",
    "result_sets",
    "review_tasks",
    "review_assignments",
    "review_decisions",
    "jobs",
)
UNREACHABLE_STATES = {State.IMPORTED, State.EXPORTED}
SUFFIX_FORMATS = {
    ".geojson": ResultFormat.GEOJSON,
    ".json": ResultFormat.PARFOCAL_JSON,
    ".csv": ResultFormat.CSV,
    ".png": ResultFormat.HEATMAP,
}


class EmptyStore:
    async def get_object(self, key: str) -> bytes:
        raise StorageError(404, "NoSuchKey")


class UnusedResults:
    async def get(self, object_key: str) -> bytes:
        raise AssertionError(object_key)


@pytest.fixture(scope="module")
def seeded() -> Iterator[str]:
    with migrated_database() as name:
        yield with_database(OWNER_URL, name)


async def run_seed(url: str, owner_email: str | None = "owner@example.test") -> uuid.UUID:
    tenant_ids = await seed(url, EmptyStore(), UnusedResults(), owner_email)  # type: ignore[arg-type]
    return tenant_ids[0]


async def counts(url: str) -> dict[str, int]:
    return {
        table: int(str((await run_sql(url, f"SELECT count(*) FROM {table}"))[0][0]))
        for table in COUNTED
    }


async def values(url: str, statement: str) -> set[str]:
    return {str(row[0]) for row in await run_sql(url, statement)}


async def seeded_states(url: str, tenant_id: uuid.UUID) -> set[State]:
    engine = create_engine(url)
    found: set[State] = set()
    try:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            task_ids = (
                await connection.scalars(
                    select(review_tasks.c.id).where(review_tasks.c.tenant_id == tenant_id)
                )
            ).all()
            for task_id in task_ids:
                states = await states_of(connection, await task_of(connection, task_id))
                for slide in states.slides:
                    found.add(slide.state)
                    found.update(reviewer.state for reviewer in slide.reviewers)
    finally:
        await engine.dispose()
    return found


async def test_seeding_twice_leaves_the_same_rows(seeded: str) -> None:
    first_tenant = await run_seed(seeded)
    first = await counts(seeded)
    second_tenant = await run_seed(seeded)
    assert second_tenant == first_tenant
    assert await counts(seeded) == first
    assert all(first[table] > 0 for table in COUNTED)


async def test_every_state_and_kind_has_a_seeded_row(seeded: str) -> None:
    tenant_id = await run_seed(seeded)
    assert set(State) - UNREACHABLE_STATES <= await seeded_states(seeded, tenant_id)
    assert await values(seeded, "SELECT DISTINCT value FROM review_decisions") == set(DecisionValue)
    assert await values(seeded, "SELECT DISTINCT decision_style FROM review_tasks") == set(
        DecisionStyle
    )
    assert await values(seeded, "SELECT DISTINCT role FROM memberships") == set(Role)
    assert await values(seeded, "SELECT DISTINCT admin_rights FROM memberships") == {
        "True",
        "False",
    }
    assert await values(seeded, "SELECT DISTINCT role FROM project_members") == set(ProjectRole)
    assert await values(seeded, "SELECT DISTINCT privacy_mode FROM projects") == set(PrivacyMode)
    assert await values(seeded, "SELECT DISTINCT status FROM jobs") == set(JobStatus)
    assert await values(seeded, "SELECT DISTINCT kind FROM review_tasks") >= {"review", "annotate"}
    suffixes = {
        Path(name).suffix for name in await values(seeded, "SELECT source_file FROM result_sets")
    }
    assert {SUFFIX_FORMATS[suffix] for suffix in suffixes} == set(ResultFormat)
    assert {Path(name).suffix for name in RESULT_FILES} == set(SUFFIX_FORMATS)
    gallery = await run_sql(seeded, "SELECT format, variant FROM slides WHERE format IS NOT NULL")
    assert {(slide.format, slide.variant) for slide in FORMAT_GALLERY} <= {
        (str(row[0]), str(row[1])) for row in gallery
    }


async def test_the_owner_is_an_admin_with_a_placeholder_subject(seeded: str) -> None:
    await run_seed(seeded, "Owner@Example.test")
    rows = await run_sql(
        seeded,
        "SELECT u.subject, m.role, m.admin_rights FROM users u "
        "JOIN memberships m ON m.user_id = u.id WHERE u.email = 'owner@example.test'",
    )
    assert rows == [("seed:owner@example.test", "researcher", True)] * len(WORKSPACES)
    names = await values(seeded, "SELECT name FROM organisations")
    assert names == {"ČVUT"}
    projects = await values(seeded, "SELECT name FROM projects")
    assert len(projects) == 3 * len(WORKSPACES)
    assert not any(name.startswith("Showcase") for name in projects)


async def test_seeded_people_are_fake(seeded: str) -> None:
    await run_seed(seeded)
    people = await run_sql(seeded, "SELECT subject, coalesce(email, '') FROM users")
    for subject, email in people:
        assert str(subject).startswith("seed:")
        assert str(email) in {"", "owner@example.test"} or str(email).endswith(".invalid")
    assert FIXTURES_MANIFEST.is_file()
    assert await values(seeded, "SELECT count(*) FROM slides WHERE barcode IS NOT NULL") == {"0"}


async def test_the_owner_takes_over_the_seeded_account_on_first_sign_in(seeded: str) -> None:
    tenant_id = await run_seed(seeded, "adopt@example.test")
    claims = {"sub": "idp-adopt", "email": "Adopt@Example.test", "email_verified": True}
    engine = create_engine(seeded)
    try:
        async with scoped_transaction(engine, DatabaseScope(auth=True)) as connection:
            assert await sign_in_user(connection, claims) == tenant_id
    finally:
        await engine.dispose()
    await run_seed(seeded, "adopt@example.test")
    rows = await run_sql(
        seeded,
        "SELECT u.subject, m.admin_rights FROM users u "
        "JOIN memberships m ON m.user_id = u.id WHERE lower(u.email) = 'adopt@example.test'",
    )
    assert rows == [("idp-adopt", True)] * len(WORKSPACES)


async def test_an_unverified_email_does_not_take_over_the_seeded_account(seeded: str) -> None:
    await run_seed(seeded, "unverified@example.test")
    claims = {"sub": "idp-unverified", "email": "unverified@example.test", "email_verified": False}
    engine = create_engine(seeded)
    try:
        async with scoped_transaction(engine, DatabaseScope(auth=True)) as connection:
            await sign_in_user(connection, claims)
    finally:
        await engine.dispose()
    owner = await values(
        seeded, "SELECT subject FROM users WHERE email = 'unverified@example.test'"
    )
    assert owner == {"seed:unverified@example.test"}
