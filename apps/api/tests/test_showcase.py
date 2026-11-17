import asyncio
import json
import re
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from db_support import OWNER_URL, migrated_database, run_sql, with_database
from sqlalchemy import select

from parfocal_api.auth import sign_in_user
from parfocal_api.evaluation_report import get_evaluation_report
from parfocal_api.principals import MemberPrincipal
from parfocal_api.project_overview import (
    get_project_overview,
    get_project_scope_options,
    get_review_task_defaults,
    list_project_slides,
)
from parfocal_api.project_uploads import get_project_imports, get_upload_batch
from parfocal_api.review_decisions import ReviewDecisionDraft, list_decisions, save_decision
from parfocal_api.review_objects import list_review_objects
from parfocal_api.review_states import State, states_of, task_of
from parfocal_api.sample_files import SampleFile
from parfocal_api.showcase import (
    ANNOTATE_DEMO,
    CELL_TOUR,
    CELLS_CHECKED,
    DEMO_TASKS,
    FIXTURES_MANIFEST,
    FORMAT_GALLERY,
    GALLERY_TOUR,
    HALF_DONE,
    RESULT_FILES,
    SUBMITTED,
    VIEWER_SAMPLE,
    WORKSPACES,
    MissingFixtureFoldersError,
    seed,
    viewer_emails_of,
)
from parfocal_api.slide_result_stats import get_slide_result_stats
from parfocal_api.slide_threads import list_slide_threads, list_thread_comments
from parfocal_api.slide_viewer import (
    NoTyperError,
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
from parfocal_common.ingest import (
    SAMPLE_FACTS_NAME,
    fixture_folder,
    fixture_original_key,
    folder_of,
    slide_prefix,
)
from parfocal_common.jobs import JobStatus
from parfocal_common.object_store import StorageError
from parfocal_common.repository import repository_root
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


OPENABLE = ("CMU-1-Small-Region.svs", "Philips-4.tiff")


def stored_fixture(name: str) -> bytes:
    return (
        SampleFile(
            original_key=fixture_original_key(name),
            file_bytes=1000,
            sha256="a" * 64,
            format="aperio-svs",
            variant="jpeg",
            reader="openslide",
            width=2220,
            height=2967,
            level_count=1,
            mpp_x=0.5,
            mpp_y=0.5,
            objective_power=20.0,
            notices=[],
        )
        .model_dump_json()
        .encode()
    )


class EmptyStore:
    def __init__(self) -> None:
        self.written: dict[str, bytes] = {}
        self.facts = {
            f"{fixture_folder(name)}{SAMPLE_FACTS_NAME}": stored_fixture(name) for name in OPENABLE
        }

    async def get_object(self, key: str) -> bytes:
        if key in self.facts:
            return self.facts[key]
        raise StorageError(404, "NoSuchKey")

    async def put_new_object(self, key: str, body: bytes, content_type: str) -> None:
        if key in self.written:
            raise StorageError(412, "PreconditionFailed")
        self.written[key] = body


class PublishedStore(EmptyStore):
    def __init__(self) -> None:
        super().__init__()
        self.facts = {
            f"{fixture_folder(slide.file)}{SAMPLE_FACTS_NAME}": stored_fixture(slide.file)
            for slide in FORMAT_GALLERY
        }


def edge_shared_folder() -> re.Pattern[str]:
    source = (repository_root(__file__, 3) / "apps/edge/src/capability.ts").read_text()
    found = re.search(r"^const SHARED_FOLDER = /(.+)/;$", source, re.MULTILINE)
    assert found is not None
    return re.compile(found.group(1))


class MemoryResults:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def get(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def get_packed(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def put(self, object_key: str, data: bytes) -> None:
        self.objects[object_key] = data


RESULTS = MemoryResults()


@pytest.fixture(scope="module")
def seeded() -> Iterator[str]:
    with migrated_database() as name:
        yield with_database(OWNER_URL, name)


async def run_seed(
    url: str, owner_email: str | None = "owner@example.test", store: EmptyStore | None = None
) -> uuid.UUID:
    used = store if store is not None else EmptyStore()
    tenant_ids = await seed(url, used, RESULTS, owner_email)  # type: ignore[arg-type]
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


async def deployed_seed(url: str, store: EmptyStore) -> list[Any]:
    await seed(url, store, RESULTS, "owner@example.test", require_fixture_folders=True)  # type: ignore[arg-type]
    return await run_sql(url, "SELECT tenant_id, id, original_key FROM slides")


def test_a_deployed_seed_refuses_to_start_without_every_gallery_folder() -> None:
    with migrated_database() as name:
        url = with_database(OWNER_URL, name)
        with pytest.raises(MissingFixtureFoldersError) as raised:
            asyncio.run(deployed_seed(url, EmptyStore()))
        assert len(raised.value.files) == len(FORMAT_GALLERY) - len(OPENABLE)
        assert asyncio.run(run_sql(url, "SELECT count(*) FROM tenants"))[0][0] == 0


def test_every_seeded_original_key_yields_a_folder_the_edge_accepts() -> None:
    shared = edge_shared_folder()
    with migrated_database() as name:
        rows = asyncio.run(deployed_seed(with_database(OWNER_URL, name), PublishedStore()))
    refused = [
        str(key)
        for tenant_id, slide_id, key in rows
        if key is not None
        and not str(key).startswith(slide_prefix(uuid.UUID(str(tenant_id)), slide_id))
        and not shared.fullmatch(folder_of(str(key)))
    ]
    assert len(rows) > len(FORMAT_GALLERY)
    assert refused == []


def test_every_seeded_slide_row_has_an_original_a_size_and_dimensions() -> None:
    with migrated_database() as name:
        url = with_database(OWNER_URL, name)
        asyncio.run(deployed_seed(url, PublishedStore()))
        bare = asyncio.run(
            run_sql(
                url,
                "SELECT label FROM slides WHERE original_key IS NULL OR file_bytes IS NULL "
                "OR width IS NULL OR height IS NULL",
            )
        )
        cases = asyncio.run(run_sql(url, "SELECT count(*) FROM slides WHERE label LIKE 'Case %'"))
    assert int(str(cases[0][0])) > 0
    assert bare == []


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


async def test_a_viewer_email_gets_a_read_only_seat_on_every_project_of_every_workspace(
    seeded: str,
) -> None:
    for _ in range(2):
        await seed(
            seeded,
            EmptyStore(),  # type: ignore[arg-type]
            RESULTS,
            "owner@example.test",
            viewer_emails=["Smoke-Walk@Example.test"],
        )
    seats = await run_sql(
        seeded,
        "SELECT t.slug, m.role, m.admin_rights, p.name, pm.role FROM users u "
        "JOIN memberships m ON m.user_id = u.id JOIN tenants t ON t.id = m.tenant_id "
        "JOIN project_members pm ON pm.user_id = u.id JOIN projects p ON p.id = pm.project_id "
        "WHERE u.email = 'smoke-walk@example.test' AND p.tenant_id = t.id",
    )
    assert {slug for slug, *_ in seats} == {workspace.slug for workspace in WORKSPACES}
    assert {(role, admin, seat) for _, role, admin, _, seat in seats} == {
        ("reviewer", False, "viewer")
    }
    assert len(seats) == len(set(seats))
    memberships_held = await run_sql(
        seeded,
        "SELECT count(*) FROM memberships m JOIN users u ON u.id = m.user_id "
        "WHERE u.email = 'smoke-walk@example.test'",
    )
    assert memberships_held == [(len(WORKSPACES),)]


def test_viewer_emails_split_on_commas_and_semicolons() -> None:
    assert viewer_emails_of(" a@x.test, b@x.test;;c@x.test ,") == [
        "a@x.test",
        "b@x.test",
        "c@x.test",
    ]
    assert viewer_emails_of("") == []


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
    results = RESULTS
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
            with pytest.raises(NoTyperError):
                await get_result_set_typer(uuid.UUID(str(set_id)), principal, connection)
            threads = await list_slide_threads(slide, principal, connection)
            for thread in threads:
                await list_thread_comments(thread.id, principal, connection)
    finally:
        await engine.dispose()


async def test_the_owner_opens_a_seeded_project_on_the_real_project_calls(seeded: str) -> None:
    await run_seed(seeded)
    project_id, tenant_id, user_id = (
        await run_sql(
            seeded,
            "SELECT t.project_id, t.tenant_id, u.id FROM review_tasks t "
            "JOIN review_assignments a ON a.task_id = t.id "
            "JOIN users u ON u.id = a.user_id "
            f"WHERE t.name = '{GALLERY_TOUR}' AND u.email = 'owner@example.test' LIMIT 1",
        )
    )[0]
    tenant = uuid.UUID(str(tenant_id))
    principal = MemberPrincipal(
        "seed:owner@example.test", tenant, uuid.UUID(str(user_id)), Role.RESEARCHER, True
    )
    project = uuid.UUID(str(project_id))
    engine = create_engine(seeded)
    try:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant)) as connection:
            overview = await get_project_overview(project, principal, connection)
            assert overview.slides > 0
            assert overview.result_sets > 0
            slides = await list_project_slides(project, principal, connection)
            assert len(slides) == overview.slides
            assert any(slide.result_set_ids for slide in slides)
            await get_project_scope_options(project, principal, connection)
            defaults = await get_review_task_defaults(project, principal, connection)
            assert defaults.slide_ids
            imports = await get_project_imports(project, principal, connection)
            assert imports.project_id == project
            batch = await get_upload_batch(project, principal, connection)
            assert batch.project_id == project
    finally:
        await engine.dispose()


async def owner_task(url: str, name: str) -> tuple[uuid.UUID, MemberPrincipal, list[uuid.UUID]]:
    rows = await run_sql(
        url,
        "SELECT t.id, t.tenant_id, u.id, ts.slide_id FROM review_tasks t "
        "JOIN review_task_slides ts ON ts.task_id = t.id "
        "JOIN review_assignments a ON a.task_id = t.id AND a.slide_id = ts.slide_id "
        "JOIN users u ON u.id = a.user_id JOIN tenants w ON w.id = t.tenant_id "
        f"WHERE t.name = '{name}' AND u.email = 'owner@example.test' "
        f"AND w.slug = '{WORKSPACES[0].slug}' ORDER BY ts.position",
    )
    task_id, tenant_id, user_id, _ = rows[0]
    principal = MemberPrincipal(
        "seed:owner@example.test",
        uuid.UUID(str(tenant_id)),
        uuid.UUID(str(user_id)),
        Role.RESEARCHER,
        True,
    )
    return uuid.UUID(str(task_id)), principal, [uuid.UUID(str(row[3])) for row in rows]


async def test_the_demo_tasks_use_templates_that_match_their_results(seeded: str) -> None:
    await run_seed(seeded)
    rows = await run_sql(
        seeded,
        "SELECT t.name, t.kind, t.scope, v.study_kind FROM review_tasks t "
        "LEFT JOIN study_template_versions v ON v.template_id = t.study_template_id "
        "AND v.version = t.study_template_version "
        f"WHERE t.name IN ({', '.join(repr(name) for name in DEMO_TASKS)})",
    )
    found = {(str(name), str(kind), str(scope), str(study)) for name, kind, scope, study in rows}
    assert found == {
        (GALLERY_TOUR, "review", "all-regions", "regions"),
        (CELL_TOUR, "review", "random-cells", "cells"),
        (HALF_DONE, "review", "all-regions", "regions"),
        (SUBMITTED, "review", "all-regions", "regions"),
        (ANNOTATE_DEMO, "annotate", "whole-slide", "regions"),
    }
    defaults = await values(
        seeded,
        "SELECT v.study_kind FROM projects p JOIN study_templates s ON s.id = p.study_template_id "
        "JOIN study_template_versions v ON v.template_id = s.id AND v.version = s.version "
        f"WHERE p.name = '{WORKSPACES[0].gallery}'",
    )
    assert defaults == {"regions"}
    every = await run_sql(
        seeded,
        "SELECT t.scope, coalesce(v.study_kind, '') FROM review_tasks t "
        "LEFT JOIN study_template_versions v ON v.template_id = t.study_template_id "
        "AND v.version = t.study_template_version WHERE t.kind = 'review'",
    )
    assert {(str(scope), str(study)) for scope, study in every} == {
        ("all-regions", "regions"),
        ("random-cells", "cells"),
    }
    unset = await values(seeded, "SELECT count(*) FROM projects WHERE study_template_id IS NULL")
    assert unset == {"0"}


async def test_every_demo_slide_has_a_regions_and_a_cells_result(seeded: str) -> None:
    await run_seed(seeded)
    rows = await run_sql(
        seeded,
        "SELECT s.id, max(r.region_count), max(r.cell_count) FROM slides s "
        "JOIN projects p ON p.id = s.project_id "
        "JOIN result_sets r ON r.slide_id = s.id AND r.status = 'ready' "
        f"WHERE p.name = '{WORKSPACES[0].gallery}' GROUP BY s.id",
    )
    assert len(rows) == len(FORMAT_GALLERY) + 1
    assert all(int(str(regions)) > 0 and int(str(cells)) > 0 for _, regions, cells in rows)


async def test_the_tour_opens_the_slides_that_open_first(seeded: str) -> None:
    await run_seed(seeded)
    _, _, slide_ids = await owner_task(seeded, GALLERY_TOUR)
    labels = [
        str(row[0])
        for row in await run_sql(
            seeded,
            "SELECT label FROM slides WHERE id IN "
            f"({', '.join(repr(str(slide_id)) for slide_id in slide_ids[:3])})",
        )
    ]
    assert set(labels) == {VIEWER_SAMPLE, *OPENABLE}


async def test_the_owner_has_objects_to_decide_in_each_open_demo_task(seeded: str) -> None:
    await run_seed(seeded)
    engine = create_engine(seeded)
    try:
        for name, kind, count in ((GALLERY_TOUR, "region", 3), (CELL_TOUR, "cell", CELLS_CHECKED)):
            task, principal, slide_ids = await owner_task(seeded, name)
            async with scoped_transaction(
                engine, DatabaseScope(tenant_id=principal.tenant_id)
            ) as connection:
                listed = await list_review_objects(
                    task,
                    slide_ids[-1],
                    principal,
                    connection,
                    RESULTS,  # type: ignore[arg-type]
                )
                assert len(listed.objects) == count
                assert {item.kind for item in listed.objects} == {kind}
    finally:
        await engine.dispose()


async def test_one_demo_task_is_half_done_and_one_is_submitted_with_a_report(
    seeded: str,
) -> None:
    await run_seed(seeded)
    half, principal, half_slides = await owner_task(seeded, HALF_DONE)
    done, _, done_slides = await owner_task(seeded, SUBMITTED)
    engine = create_engine(seeded)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(tenant_id=principal.tenant_id)
        ) as connection:
            states = await states_of(connection, await task_of(connection, half))
            by_slide = {slide.slide_id: slide for slide in states.slides}
            submitted = [
                slide_id
                for slide_id in half_slides
                if by_slide[slide_id].reviewers[0].submitted_at is not None
            ]
            assert submitted == half_slides[:1]
            decided = await list_decisions(half, half_slides[1], principal, connection)
            assert len(decided) == 3
            assert not await list_decisions(half, half_slides[2], principal, connection)
            done_states = await states_of(connection, await task_of(connection, done))
            assert len(done_slides) == 2
            assert all(
                reviewer.submitted_at is not None
                for slide in done_states.slides
                for reviewer in slide.reviewers
            )
            report = await get_evaluation_report(done, principal, connection)
            assert report.slides == 2
            assert report.objects > 0
    finally:
        await engine.dispose()


async def test_the_owner_has_an_annotate_task(seeded: str) -> None:
    await run_seed(seeded)
    task, _, slide_ids = await owner_task(seeded, ANNOTATE_DEMO)
    kinds = await values(seeded, f"SELECT kind FROM review_tasks WHERE id = '{task}'")
    assert kinds == {"annotate"}
    assert len(slide_ids) == 2


async def test_a_listed_viewer_can_see_every_project_without_admin_rights(seeded: str) -> None:
    for _ in range(2):
        await seed(
            seeded,
            EmptyStore(),  # type: ignore[arg-type]
            RESULTS,  # type: ignore[arg-type]
            "owner@example.test",
            viewer_emails=viewer_emails_of(" Watcher@Example.test ,"),
        )
    members = await run_sql(
        seeded,
        "SELECT u.subject, m.role, m.admin_rights FROM users u "
        "JOIN memberships m ON m.user_id = u.id WHERE u.email = 'watcher@example.test'",
    )
    assert [(str(s), str(r), a) for s, r, a in members] == [
        ("seed:watcher@example.test", "reviewer", False)
    ] * len(WORKSPACES)
    assert await values(
        seeded,
        "SELECT t.slug FROM users u JOIN tenants t ON t.id = u.last_tenant_id "
        "WHERE u.email = 'watcher@example.test'",
    ) == {WORKSPACES[-1].slug}
    roles = await values(
        seeded,
        "SELECT pm.role FROM project_members pm JOIN users u ON u.id = pm.user_id "
        "WHERE u.email = 'watcher@example.test'",
    )
    assert roles == {"viewer"}
    covered = await values(
        seeded,
        "SELECT count(*) FROM project_members pm JOIN users u ON u.id = pm.user_id "
        "WHERE u.email = 'watcher@example.test'",
    )
    assert covered == {str(3 * len(WORKSPACES))}
