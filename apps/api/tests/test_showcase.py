import json
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from db_support import OWNER_URL, migrated_database, run_sql, with_database
from sqlalchemy import select

from parfocal_api.auth import sign_in_user
from parfocal_api.principals import MemberPrincipal
from parfocal_api.review_decisions import ReviewDecisionDraft, list_decisions, save_decision
from parfocal_api.review_objects import list_review_objects
from parfocal_api.review_states import State, states_of, task_of
from parfocal_api.showcase import (
    FIXTURES_MANIFEST,
    FORMAT_GALLERY,
    GALLERY_TOUR,
    RESULT_FILES,
    VIEWER_SAMPLE,
    WORKSPACES,
    seed,
)
from parfocal_api.slide_result_stats import get_slide_result_stats
from parfocal_api.slide_threads import list_slide_threads, list_thread_comments
from parfocal_api.slide_viewer import (
    get_result_set_typer,
    get_slide_ai_progress,
    list_annotation_layers,
)
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
    def __init__(self) -> None:
        self.written: dict[str, bytes] = {}

    async def get_object(self, key: str) -> bytes:
        raise StorageError(404, "NoSuchKey")

    async def put_new_object(self, key: str, body: bytes, content_type: str) -> None:
        if key in self.written:
            raise StorageError(412, "PreconditionFailed")
        self.written[key] = body


class UnusedResults:
    async def get(self, object_key: str) -> bytes:
        raise AssertionError(object_key)


@pytest.fixture(scope="module")
def seeded() -> Iterator[str]:
    with migrated_database() as name:
        yield with_database(OWNER_URL, name)


async def run_seed(
    url: str, owner_email: str | None = "owner@example.test", store: EmptyStore | None = None
) -> uuid.UUID:
    used = store if store is not None else EmptyStore()
    tenant_ids = await seed(url, used, UnusedResults(), owner_email)  # type: ignore[arg-type]
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


async def test_the_owner_can_open_the_format_gallery(seeded: str) -> None:
    await run_seed(seeded)
    rows = await run_sql(
        seeded,
        "SELECT p.name, pm.role FROM project_members pm "
        "JOIN projects p ON p.id = pm.project_id "
        "JOIN users u ON u.id = pm.user_id WHERE u.email = 'owner@example.test'",
    )
    assert {(str(name), str(role)) for name, role in rows} == {
        (workspace.gallery, "owner") for workspace in WORKSPACES
    }


async def test_the_owner_reviews_a_gallery_tour_that_opens_on_the_camelyon_sample(
    seeded: str,
) -> None:
    store = EmptyStore()
    await run_seed(seeded, store=store)
    rows = await run_sql(
        seeded,
        "SELECT p.name, t.kind, s.label, s.original_key, ts.position "
        "FROM review_tasks t JOIN projects p ON p.id = t.project_id "
        "JOIN review_task_slides ts ON ts.task_id = t.id JOIN slides s ON s.id = ts.slide_id "
        f"WHERE t.name = '{GALLERY_TOUR}' ORDER BY p.name, ts.position",
    )
    first = {
        str(name): (str(label), str(key)) for name, _, label, key, position in rows if position == 0
    }
    assert first == {
        workspace.gallery: (VIEWER_SAMPLE, f"samples/camelyon16/{VIEWER_SAMPLE}/original.tif")
        for workspace in WORKSPACES
    }
    assert {str(kind) for _, kind, _, _, _ in rows} == {"review"}
    assert len(rows) == len(WORKSPACES) * (len(FORMAT_GALLERY) + 1)
    assigned = await run_sql(
        seeded,
        "SELECT DISTINCT u.email FROM review_assignments a JOIN review_tasks t ON t.id = a.task_id "
        f"JOIN users u ON u.id = a.user_id WHERE t.name = '{GALLERY_TOUR}'",
    )
    assert [str(email) for (email,) in assigned] == ["owner@example.test"]


async def test_the_sample_restricted_ranges_are_stored_once_and_kept(seeded: str) -> None:
    store = EmptyStore()
    await run_seed(seeded, store=store)
    await run_seed(seeded, store=store)
    ranges = json.loads(store.written[f"samples/camelyon16/{VIEWER_SAMPLE}/restricted-ranges.json"])
    assert ranges["ranges"] == []
    assert ranges["identifying"]
    assert ranges["barcode"]


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
            assert (await sign_in_user(connection, claims)).tenant_id == tenant_id
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


async def test_the_owner_reviews_the_gallery_tour_on_the_real_review_calls(seeded: str) -> None:
    await run_seed(seeded)
    task_id, slide_id, tenant_id, user_id = (
        await run_sql(
            seeded,
            "SELECT t.id, ts.slide_id, t.tenant_id, u.id FROM review_tasks t "
            "JOIN review_task_slides ts ON ts.task_id = t.id "
            "JOIN review_assignments a ON a.task_id = t.id AND a.slide_id = ts.slide_id "
            "JOIN users u ON u.id = a.user_id "
            f"WHERE t.name = '{GALLERY_TOUR}' AND u.email = 'owner@example.test' "
            "AND ts.position = 0 LIMIT 1",
        )
    )[0]
    tenant = uuid.UUID(str(tenant_id))
    principal = MemberPrincipal(
        "seed:owner@example.test", tenant, uuid.UUID(str(user_id)), Role.RESEARCHER, True
    )
    task, slide = uuid.UUID(str(task_id)), uuid.UUID(str(slide_id))
    results = UnusedResults()
    engine = create_engine(seeded)
    try:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant)) as connection:
            listed = await list_review_objects(task, slide, principal, connection, results)  # type: ignore[arg-type]
            assert listed.objects
            first = listed.objects[0]
            assert first.class_name
            await save_decision(
                task,
                slide,
                first.object,
                ReviewDecisionDraft(value=DecisionValue.AGREE),
                principal,
                connection,
                results,  # type: ignore[arg-type]
            )
            saved = await list_decisions(task, slide, principal, connection)
            assert [decision.object for decision in saved] == [first.object]
    finally:
        await engine.dispose()


async def test_the_owner_opens_a_seeded_slide_on_the_real_viewer_calls(seeded: str) -> None:
    await run_seed(seeded)
    task_id, slide_id, set_id, tenant_id, user_id = (
        await run_sql(
            seeded,
            "SELECT t.id, ts.slide_id, ts.result_set_id, t.tenant_id, u.id FROM review_tasks t "
            "JOIN review_task_slides ts ON ts.task_id = t.id "
            "JOIN review_assignments a ON a.task_id = t.id AND a.slide_id = ts.slide_id "
            "JOIN users u ON u.id = a.user_id "
            f"WHERE t.name = '{GALLERY_TOUR}' AND u.email = 'owner@example.test' "
            "AND ts.position = 0 LIMIT 1",
        )
    )[0]
    tenant = uuid.UUID(str(tenant_id))
    principal = MemberPrincipal(
        "seed:owner@example.test", tenant, uuid.UUID(str(user_id)), Role.RESEARCHER, True
    )
    task, slide = uuid.UUID(str(task_id)), uuid.UUID(str(slide_id))
    engine = create_engine(seeded)
    try:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant)) as connection:
            stats = await get_slide_result_stats(task, slide, principal, connection)
            assert stats.object_count > 0
            assert sum(stats.score_bins) > 0
            progress = await get_slide_ai_progress(slide, principal, connection)
            assert progress.state == "ready"
            layers = await list_annotation_layers(slide, principal, connection)
            assert layers.slide_id == slide
            typer = await get_result_set_typer(uuid.UUID(str(set_id)), principal, connection)
            assert typer.name
            threads = await list_slide_threads(slide, principal, connection)
            for thread in threads:
                await list_thread_comments(thread.id, principal, connection)
    finally:
        await engine.dispose()
