import argparse
import asyncio
import json
import os
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx2
from fastapi import BackgroundTasks
from sqlalchemy import func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import actor_of
from parfocal_api.auth import SEEDED_SUBJECT_PREFIX
from parfocal_api.class_templates import TaxonomyTemplate
from parfocal_api.decision_styles import DecisionSettings
from parfocal_api.opinions import OpinionChange, save_opinion
from parfocal_api.principals import MemberPrincipal
from parfocal_api.projects import ProjectDraft, create_project
from parfocal_api.realtime import NoRealtime
from parfocal_api.result_sets import (
    ChunkRow,
    RegionRow,
    ResultSetDraft,
    add_chunks,
    add_regions,
    cells_per_class,
    fail,
    finish,
    insert_result_set,
)
from parfocal_api.review_decisions import ReviewDecisionDraft, save_decision
from parfocal_api.review_objects import list_review_objects
from parfocal_api.review_order import cancel_order_jobs, stored_seeds
from parfocal_api.review_order_job import order_one_slide
from parfocal_api.review_states import submit_slide_review
from parfocal_api.review_tasks import Scope, SlideSet, TaskDraft, create_review_task
from parfocal_api.sample_files import SampleFile, stored_facts, stored_sample_file
from parfocal_api.sample_project import SAMPLE_SLIDES, square
from parfocal_api.study_templates import seed_built_ins
from parfocal_api.tables import (
    AnalysisTemplate,
    BuiltInTemplate,
    DecisionReason,
    DecisionStyle,
    DecisionValue,
    PrivacyMode,
    ProjectRole,
    ResultObjectKind,
    ResultSource,
    Role,
    TaskKind,
    TaskScope,
    TaskSplit,
    memberships,
    organisations,
    project_members,
    projects,
    review_assignments,
    review_decisions,
    review_task_slides,
    review_tasks,
    slides,
    study_templates,
    tenants,
    users,
    workspace_settings,
)
from parfocal_common.chunk_store import Cell, build_cells, write_cells
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.ingest import (
    RESTRICTED_RANGES_NAME,
    fixture_folder,
    sample_folder,
    sample_original_key,
)
from parfocal_common.jobs import JobStatus, jobs
from parfocal_common.object_store import ObjectStore, StorageError
from parfocal_common.repository import repository_root
from parfocal_common.result_store import ObjectResultStore, ResultStore
from parfocal_common.settings import AppEnv, StorageSettings

ORGANISATION_SLUG = "cvut"
ORGANISATION_NAME = "ČVUT"
PLACEHOLDER_PREFIX = SEEDED_SUBJECT_PREFIX
INERT_JOB_KIND = "showcase"
FIXTURE_PREFIX = "fixtures/"
FIXTURES_MANIFEST = repository_root(__file__) / "packages/test-fixtures/fixtures.json"


@dataclass(frozen=True)
class FakePerson:
    key: str
    name: str
    initials: str
    role: Role
    admin_rights: bool = False

    @property
    def subject(self) -> str:
        return f"{PLACEHOLDER_PREFIX}{self.key}@showcase.invalid"


PEOPLE = (
    FakePerson("ada", "Ada Admin", "AA", Role.RESEARCHER, admin_rights=True),
    FakePerson("rui", "Rui Researcher", "RR", Role.RESEARCHER),
    FakePerson("rhea", "Rhea Reviewer", "RH", Role.REVIEWER),
    FakePerson("remy", "Remy Reviewer", "RM", Role.REVIEWER),
    FakePerson("vic", "Vic Viewer", "VV", Role.REVIEWER),
)


@dataclass(frozen=True)
class Workspace:
    slug: str
    name: str
    study: str
    clinical_study: str
    gallery: str


WORKSPACES = (
    Workspace(
        "cvut-biomedical",
        "ČVUT · Biomedical Engineering",
        "Sentinel node metastasis study",
        "Breast surgery sentinel nodes",
        "Scanner format comparison",
    ),
    Workspace(
        "cvut-imaging",
        "ČVUT · Medical Imaging Group",
        "Lymph node segmentation benchmark",
        "Partner hospital node review",
        "Whole-slide format survey",
    ),
    Workspace(
        "cvut-ml",
        "ČVUT · Machine Learning Lab",
        "Metastasis detector validation",
        "Detector clinical pilot",
        "Vendor format robustness",
    ),
)


@dataclass(frozen=True)
class GallerySlide:
    file: str
    format: str
    variant: str


FORMAT_GALLERY = (
    GallerySlide("CMU-1-Small-Region.svs", "aperio-svs", "jpeg"),
    GallerySlide("JP2K-33003-1.svs", "aperio-svs", "jpeg2000-ycbcr"),
    GallerySlide("CMU-1-JP2K-33005.svs", "aperio-svs", "jpeg2000-rgb"),
    GallerySlide("CMU-1.ndpi", "hamamatsu-ndpi", "tiff"),
    GallerySlide("Leica-1.scn", "leica-scn", "bigtiff"),
    GallerySlide("Ventana-1.bif", "ventana-bif", "bigtiff"),
    GallerySlide("Philips-4.tiff", "philips-tiff", "bigtiff"),
    GallerySlide("Huron-1-40x.tif", "huron-tiff", "bigtiff"),
    GallerySlide("Argos-1.avs", "argos-avs", "bigtiff"),
    GallerySlide("CMU-1.tiff", "generic-tiff", "tiff"),
    GallerySlide("CMU-1-Saved-1_16.zip", "mirax", "zip"),
    GallerySlide("CMU-1-JP2K-33005-v2.zip", "dicom", "zip"),
    GallerySlide("synthetic-zlib.ome.tiff", "ome-tiff", "tiff"),
)

STATE_SLIDES = (
    "ready",
    "assigned",
    "in-review",
    "submitted",
    "disagreement",
    "signed-off",
    "ai-running",
    "uploaded",
)
RESULT_FILES = ("cells.geojson", "regions.parfocal.json", "cells.csv", "heatmap.png")
VIEWER_SAMPLE = "test_065"
VIEWER_SAMPLE_FILE = f"{VIEWER_SAMPLE}.tif"
VIEWER_SAMPLE_RANGES = {
    "ranges": [],
    "identifying": [[309569679, 309569800]],
    "barcode": [[309578626, 309578638]],
}
GALLERY_TOUR = "Format gallery tour"
CELL_TOUR = "Cell typing tour"
HALF_DONE = "Half done review"
SUBMITTED = "Submitted review"
ANNOTATE_DEMO = "Tumour outline practice"
DEMO_TASKS = (GALLERY_TOUR, CELL_TOUR, HALF_DONE, SUBMITTED, ANNOTATE_DEMO)
CELL_CLASSES = ("Tumor cell", "Lymphocyte", "Stroma cell")
DEMO_CELLS = 24
CELLS_CHECKED = 12
DEMO_WIDTH = 32000
DEMO_HEIGHT = 24000
DEMO_OPINION = {"acceptable": 4}
OWNER_SUBJECT = f"{PLACEHOLDER_PREFIX}owner"
ALREADY_STORED = 412


@dataclass
class Seeded:
    tenant_id: uuid.UUID
    people: dict[str, uuid.UUID]
    owner: uuid.UUID | None = None


def fixture_facts(manifest: Path = FIXTURES_MANIFEST) -> dict[str, Mapping[str, Any]]:
    listed = json.loads(manifest.read_text())
    return {entry["file"]: entry for entry in [*listed["remote"], *listed["synthetic"]]}


def placeholder_subject(email: str) -> str:
    return f"{PLACEHOLDER_PREFIX}{email.strip().lower()}"


async def lock(connection: AsyncConnection) -> None:
    await connection.execute(
        select(func.pg_advisory_xact_lock(func.hashtextextended("showcase-seed", 0)))
    )


async def existing_tenant(connection: AsyncConnection, slug: str) -> uuid.UUID | None:
    return await connection.scalar(select(tenants.c.id).where(tenants.c.slug == slug))


async def organisation(connection: AsyncConnection) -> uuid.UUID:
    found = await connection.scalar(
        select(organisations.c.id).where(organisations.c.slug == ORGANISATION_SLUG)
    )
    created = found or await connection.scalar(
        insert(organisations)
        .values(slug=ORGANISATION_SLUG, name=ORGANISATION_NAME)
        .returning(organisations.c.id)
    )
    assert isinstance(created, uuid.UUID)
    return created


async def new_tenant(
    connection: AsyncConnection, organisation_id: uuid.UUID, workspace: Workspace
) -> uuid.UUID:
    tenant_id = await connection.scalar(
        insert(tenants)
        .values(
            organisation_id=organisation_id,
            slug=workspace.slug,
            name=workspace.name,
            kind="research",
            region="eu",
            plan="pilot",
        )
        .returning(tenants.c.id)
    )
    assert isinstance(tenant_id, uuid.UUID)
    await connection.execute(
        insert(workspace_settings).values(
            tenant_id=tenant_id, security_contact="security@showcase.invalid"
        )
    )
    await seed_built_ins(connection, tenant_id)
    return tenant_id


async def add_member(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    subject: str,
    name: str,
    initials: str,
    role: Role,
    *,
    admin_rights: bool,
    email: str | None = None,
) -> uuid.UUID:
    user_id = await connection.scalar(
        upsert(users)
        .values(
            subject=subject,
            email=email,
            display_name=name,
            initials=initials,
            avatar_colour=len(name) % 12,
            last_tenant_id=tenant_id,
        )
        .on_conflict_do_update(index_elements=[users.c.subject], set_={"last_tenant_id": tenant_id})
        .returning(users.c.id)
    )
    assert isinstance(user_id, uuid.UUID)
    member = await connection.scalar(
        select(memberships.c.id).where(
            memberships.c.tenant_id == tenant_id, memberships.c.user_id == user_id
        )
    )
    if member is None:
        await connection.execute(
            insert(memberships).values(
                tenant_id=tenant_id, user_id=user_id, role=role, admin_rights=admin_rights
            )
        )
    return user_id


async def add_owner(connection: AsyncConnection, tenant_id: uuid.UUID, email: str) -> uuid.UUID:
    address = email.strip().lower()
    signed_in = await connection.scalar(
        select(users.c.subject).where(func.lower(users.c.email) == address).limit(1)
    )
    subject = signed_in or placeholder_subject(address)
    return await add_member(
        connection,
        tenant_id,
        subject,
        "Workspace owner",
        "WO",
        Role.RESEARCHER,
        admin_rights=True,
        email=address,
    )


def principal_of(seeded: Seeded, key: str, role: Role, admin_rights: bool) -> MemberPrincipal:
    return MemberPrincipal(
        f"{PLACEHOLDER_PREFIX}{key}@showcase.invalid",
        seeded.tenant_id,
        seeded.people[key],
        role,
        admin_rights,
    )


async def join(
    connection: AsyncConnection,
    seeded: Seeded,
    project_id: uuid.UUID,
    roles: Mapping[str, ProjectRole],
) -> None:
    for key, role in roles.items():
        await connection.execute(
            upsert(project_members)
            .values(
                tenant_id=seeded.tenant_id,
                project_id=project_id,
                user_id=seeded.people[key],
                role=role,
            )
            .on_conflict_do_nothing()
        )


async def add_slide(
    connection: AsyncConnection,
    seeded: Seeded,
    project_id: uuid.UUID,
    label: str,
    facts: Mapping[str, Any],
) -> Any:
    slide_id = await connection.scalar(
        insert(slides)
        .values(tenant_id=seeded.tenant_id, project_id=project_id, label=label, **facts)
        .returning(slides.c.id)
    )
    assert isinstance(slide_id, uuid.UUID)
    return await slide_row(connection, slide_id)


async def slide_row(connection: AsyncConnection, slide_id: uuid.UUID) -> Any:
    return (
        await connection.execute(
            select(slides.c.id, slides.c.project_id).where(slides.c.id == slide_id)
        )
    ).one()


def sample_facts(stored: SampleFile | None) -> dict[str, Any]:
    return {} if stored is None else {**stored.model_dump(), "published_at": func.now()}


def gallery_facts(
    slide: GallerySlide,
    manifest: Mapping[str, Mapping[str, Any]],
    stored: SampleFile | None = None,
) -> dict[str, Any]:
    if stored is not None:
        return sample_facts(stored)
    entry = manifest[slide.file]
    return {
        "format": slide.format,
        "variant": slide.variant,
        "file_bytes": int(entry["bytes"]),
        "sha256": str(entry["sha256"]),
        "original_key": f"{FIXTURE_PREFIX}{slide.file}",
        "published_at": func.now(),
    }


def viewer_sample_facts(manifest: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    entry = manifest[VIEWER_SAMPLE_FILE]
    return {
        "format": "philips-tiff",
        "variant": "bigtiff",
        "reader": "openslide",
        "width": 77824,
        "height": 53760,
        "level_count": 9,
        "mpp_x": 0.226321,
        "mpp_y": 0.226316,
        "objective_power": 40.0,
        "notices": ["objective-estimated"],
        "file_bytes": int(entry["bytes"]),
        "sha256": str(entry["sha256"]),
        "original_key": sample_original_key(VIEWER_SAMPLE, VIEWER_SAMPLE_FILE),
        "published_at": func.now(),
    }


async def ready_set(
    connection: AsyncConnection,
    principal: MemberPrincipal,
    slide: Any,
    source_file: str,
    source: ResultSource = ResultSource.IMPORT,
    job_id: uuid.UUID | None = None,
) -> uuid.UUID:
    draft = ResultSetDraft(
        name="Tumour detector v1",
        model_version="v1.0",
        classes=["Tumor"],
        source_file=source_file,
    )
    set_id = await insert_result_set(
        connection,
        principal.tenant_id,
        slide,
        draft,
        source,
        actor_of(principal),
        principal.user_id,
        job_id,
    )
    rows = [
        RegionRow(
            kind=ResultObjectKind.REGION,
            number=index + 1,
            wkt=square(index, 0),
            class_position=0,
            score=220 - index * 50,
        )
        for index in range(3)
    ]
    await add_regions(connection, set_id, rows)
    if source is ResultSource.IMPORT:
        await finish(connection, set_id)
    return set_id


async def add_jobs(
    connection: AsyncConnection, seeded: Seeded, project_id: uuid.UUID
) -> dict[JobStatus, uuid.UUID]:
    made: dict[JobStatus, uuid.UUID] = {}
    for status in JobStatus:
        finished = status in {JobStatus.DONE, JobStatus.FAILED, JobStatus.CANCELLED}
        job_id = await connection.scalar(
            insert(jobs)
            .values(
                tenant_id=seeded.tenant_id,
                project_id=project_id,
                kind=INERT_JOB_KIND,
                status=status,
                pause_reason="showcase" if status is JobStatus.PAUSED else None,
                error_code="showcase" if status is JobStatus.FAILED else None,
                finished_at=func.now() if finished else None,
            )
            .returning(jobs.c.id)
        )
        assert isinstance(job_id, uuid.UUID)
        made[status] = job_id
    return made


async def decide(
    connection: AsyncConnection,
    seeded: Seeded,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    key: str,
    value: DecisionValue,
    reasons: list[DecisionReason] | None = None,
) -> None:
    await connection.execute(
        insert(review_decisions).values(
            tenant_id=seeded.tenant_id,
            project_id=project_id,
            task_id=task_id,
            slide_id=slide_id,
            user_id=seeded.people[key],
            kind="region",
            number=1,
            value=value,
            style=DecisionStyle.AGREE,
            answer=value,
            reasons=[reason.value for reason in reasons or []],
        )
    )


async def submit(connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID) -> None:
    await connection.execute(
        update(review_assignments)
        .where(review_assignments.c.task_id == task_id, review_assignments.c.slide_id == slide_id)
        .values(submitted_at=func.now())
    )


async def agree_and_submit(
    connection: AsyncConnection,
    seeded: Seeded,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> None:
    for key in ("rhea", "remy"):
        await decide(connection, seeded, project_id, task_id, slide_id, key, DecisionValue.AGREE)
    await submit(connection, task_id, slide_id)


async def review_task(
    connection: AsyncConnection,
    principal: MemberPrincipal,
    results: ResultStore,
    project_id: uuid.UUID,
    name: str,
    sets: Mapping[uuid.UUID, uuid.UUID | None],
    reviewers: list[uuid.UUID],
    style: DecisionStyle,
    kind: TaskKind = TaskKind.REVIEW,
    template_id: uuid.UUID | None = None,
    scope: Scope | None = None,
) -> uuid.UUID:
    reviewing = kind is TaskKind.REVIEW
    draft = TaskDraft(
        name=name,
        kind=kind,
        slide_ids=list(sets),
        result_sets=[
            SlideSet(slide_id=slide_id, result_set_id=set_id)
            for slide_id, set_id in sets.items()
            if set_id is not None
        ],
        reviewer_ids=reviewers,
        split=TaskSplit.EVERYONE,
        scope=(scope or Scope(kind=TaskScope.ALL_REGIONS)) if reviewing else None,
        blinded=False,
        decision=DecisionSettings(style=style) if reviewing else None,
    )
    if template_id is not None:
        draft = draft.model_copy(update={"study_template_id": template_id})
    task = await create_review_task(
        project_id,
        draft,
        principal,
        connection,
        results,
        NoRealtime(),
        BackgroundTasks(),
    )
    return task.id


async def seed_states(
    connection: AsyncConnection,
    seeded: Seeded,
    principal: MemberPrincipal,
    results: ResultStore,
    project_id: uuid.UUID,
    sample: SampleFile | None,
    job_ids: Mapping[JobStatus, uuid.UUID],
) -> None:
    sets: dict[uuid.UUID, uuid.UUID] = {}
    named: dict[str, uuid.UUID] = {}
    for index, state in enumerate(STATE_SLIDES):
        slide = await add_slide(
            connection, seeded, project_id, f"Case {state}", sample_facts(sample)
        )
        named[state] = slide.id
        sets[slide.id] = await ready_set(
            connection, principal, slide, RESULT_FILES[index % len(RESULT_FILES)]
        )
    reviewers = [seeded.people["rhea"], seeded.people["remy"]]
    signed_off = named["signed-off"]
    signed_set = sets.pop(signed_off)
    task_id = await review_task(
        connection,
        principal,
        results,
        project_id,
        "Every state review",
        sets,
        reviewers,
        DecisionStyle.AGREE,
    )
    await connection.execute(
        update(review_assignments)
        .where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.slide_id == named["ready"],
        )
        .values(released_at=func.now())
    )
    await decide(
        connection,
        seeded,
        project_id,
        task_id,
        named["in-review"],
        "rhea",
        DecisionValue.UNSURE,
        [DecisionReason.NEED_SECOND_LOOK, DecisionReason.BORDER_UNCLEAR],
    )
    await agree_and_submit(connection, seeded, project_id, task_id, named["submitted"])
    await decide(
        connection, seeded, project_id, task_id, named["disagreement"], "rhea", DecisionValue.AGREE
    )
    await decide(
        connection,
        seeded,
        project_id,
        task_id,
        named["disagreement"],
        "remy",
        DecisionValue.DISAGREE,
        [DecisionReason.BOUNDARY_OFF],
    )
    await submit(connection, task_id, named["disagreement"])
    closed_id = await review_task(
        connection,
        principal,
        results,
        project_id,
        "Signed-off review",
        {signed_off: signed_set},
        reviewers,
        DecisionStyle.AGREE,
    )
    await agree_and_submit(connection, seeded, project_id, closed_id, signed_off)
    await connection.execute(
        update(review_tasks)
        .where(review_tasks.c.id == closed_id)
        .values(signed_off_at=func.now(), signed_off_by_user_id=principal.user_id)
    )
    running = await ready_set(
        connection,
        principal,
        await slide_row(connection, named["ai-running"]),
        "run.geojson",
        ResultSource.RUN,
        job_ids[JobStatus.RUNNING],
    )
    broken = await insert_result_set(
        connection,
        principal.tenant_id,
        await slide_row(connection, named["uploaded"]),
        ResultSetDraft(name="Broken import", source_file="broken.csv"),
        ResultSource.IMPORT,
        actor_of(principal),
        principal.user_id,
    )
    await fail(connection, broken, "showcase")
    for slide_id, set_id in ((named["ai-running"], running), (named["uploaded"], broken)):
        await connection.execute(
            update(review_task_slides)
            .where(
                review_task_slides.c.task_id == task_id,
                review_task_slides.c.slide_id == slide_id,
            )
            .values(result_set_id=set_id)
        )


async def seed_styles(
    connection: AsyncConnection,
    seeded: Seeded,
    principal: MemberPrincipal,
    results: ResultStore,
    project_id: uuid.UUID,
    sample: SampleFile | None,
) -> None:
    for style in DecisionStyle:
        slide = await add_slide(
            connection, seeded, project_id, f"Case {style} style", sample_facts(sample)
        )
        set_id = await ready_set(connection, principal, slide, "regions.parfocal.json")
        task_id = await review_task(
            connection,
            principal,
            results,
            project_id,
            f"{style.capitalize()} decisions review",
            {slide.id: set_id},
            [seeded.people["rhea"]],
            style,
        )
        if style is DecisionStyle.AGREE:
            await decide(
                connection,
                seeded,
                project_id,
                task_id,
                slide.id,
                "rhea",
                DecisionValue.DISAGREE,
                [DecisionReason.BOUNDARY_OFF],
            )
    slide = await add_slide(connection, seeded, project_id, "Case annotate", sample_facts(sample))
    await review_task(
        connection,
        principal,
        results,
        project_id,
        "Tumour annotation",
        {slide.id: None},
        [seeded.people["rhea"]],
        DecisionStyle.CERTAINTY,
        TaskKind.ANNOTATE,
    )


async def seed_gallery(
    connection: AsyncConnection,
    seeded: Seeded,
    principal: MemberPrincipal,
    store: ObjectStore,
    manifest: Mapping[str, Mapping[str, Any]],
    name: str,
) -> None:
    project = await create_project(
        ProjectDraft(name=name, privacy_mode=PrivacyMode.DE_IDENTIFIED),
        principal,
        connection,
    )
    await join(connection, seeded, project.id, {"rhea": ProjectRole.VIEWER})
    for slide in FORMAT_GALLERY:
        stored = await stored_facts(store, fixture_folder(slide.file))
        await add_slide(
            connection, seeded, project.id, slide.file, gallery_facts(slide, manifest, stored)
        )


@dataclass
class DemoSets:
    regions: dict[uuid.UUID, uuid.UUID | None]
    cells: dict[uuid.UUID, uuid.UUID | None]


async def built_in_templates(
    connection: AsyncConnection, tenant_id: uuid.UUID
) -> dict[BuiltInTemplate, uuid.UUID]:
    rows = await connection.execute(
        select(study_templates.c.built_in, study_templates.c.id).where(
            study_templates.c.tenant_id == tenant_id, study_templates.c.built_in.is_not(None)
        )
    )
    return {BuiltInTemplate(built_in): template_id for built_in, template_id in rows}


def box(left: int, top: int, size: int) -> str:
    right, bottom = left + size, top + size
    return f"POLYGON(({left} {top},{right} {top},{right} {bottom},{left} {bottom},{left} {top}))"


def demo_regions(width: int, height: int) -> list[RegionRow]:
    size = max(min(width, height) // 8, 16)
    top = height // 2 - size // 2
    return [
        RegionRow(
            kind=ResultObjectKind.REGION,
            number=index + 1,
            wkt=box(width * (index + 1) // 4 - size // 2, top, size),
            class_position=0,
            score=220 - index * 50,
        )
        for index in range(3)
    ]


def demo_cells(width: int, height: int) -> list[Cell]:
    size = max(min(width, height) // 60, 4)
    left, top = width // 2 - 3 * size * 2, height // 4
    cells: list[Cell] = []
    for index in range(DEMO_CELLS):
        x = left + (index % 6) * size * 2
        y = top + (index // 6) * size * 2
        cells.append(
            Cell(
                number=index + 1,
                ring=(x, y, x + size, y, x + size, y + size, x, y + size),
                class_index=index % len(CELL_CLASSES),
                score=250 - index * 9,
            )
        )
    return cells


async def add_demo_sets(
    connection: AsyncConnection,
    principal: MemberPrincipal,
    results: ResultStore,
    slide_id: uuid.UUID,
    demo: DemoSets,
) -> None:
    slide = (
        await connection.execute(
            select(slides.c.id, slides.c.project_id, slides.c.width, slides.c.height).where(
                slides.c.id == slide_id
            )
        )
    ).one()
    width, height = slide.width or DEMO_WIDTH, slide.height or DEMO_HEIGHT
    regions_id = await insert_result_set(
        connection,
        principal.tenant_id,
        slide,
        ResultSetDraft(
            name="Tumour detector v1",
            model_version="v1.0",
            classes=["Tumor"],
            source_file="regions.parfocal.json",
        ),
        ResultSource.IMPORT,
        actor_of(principal),
        principal.user_id,
    )
    await add_regions(connection, regions_id, demo_regions(width, height))
    await finish(connection, regions_id)
    cells_id = await insert_result_set(
        connection,
        principal.tenant_id,
        slide,
        ResultSetDraft(
            name="Cell typer v1",
            model_version="v1.0",
            classes=list(CELL_CLASSES),
            source_file="cells.geojson",
        ),
        ResultSource.IMPORT,
        actor_of(principal),
        principal.user_id,
    )
    built = build_cells(
        principal.tenant_id,
        slide_id,
        cells_id,
        demo_cells(width, height),
        len(CELL_CLASSES),
    )
    entries = await write_cells(results, built)
    await add_chunks(connection, cells_id, [ChunkRow.of(entry) for entry in entries])
    await finish(connection, cells_id, cells_per_class(entries))
    demo.regions[slide_id] = regions_id
    demo.cells[slide_id] = cells_id


async def order_now(
    connection: AsyncConnection,
    results: ResultStore,
    task_id: uuid.UUID,
    slide_ids: list[uuid.UUID],
) -> None:
    seeds = await stored_seeds(connection, task_id, slide_ids)
    for slide_id, seed in seeds.items():
        await order_one_slide(connection, results, task_id, slide_id, seed)
    await cancel_order_jobs(connection, task_id)


async def decide_all(
    connection: AsyncConnection,
    principal: MemberPrincipal,
    results: ResultStore,
    task_id: uuid.UUID,
    slide_ids: list[uuid.UUID],
    *,
    submit: bool,
) -> None:
    for slide_id in slide_ids:
        listed = await list_review_objects(task_id, slide_id, principal, connection, results)
        for position, found in enumerate(listed.objects):
            draft = (
                ReviewDecisionDraft(
                    value=DecisionValue.DISAGREE, reasons=[DecisionReason.BOUNDARY_OFF]
                )
                if position == len(listed.objects) - 1
                else ReviewDecisionDraft(value=DecisionValue.AGREE)
            )
            await save_decision(
                task_id, slide_id, found.object, draft, principal, connection, results
            )
        await save_opinion(
            task_id, slide_id, OpinionChange(answers=DEMO_OPINION), principal, connection
        )
        if submit:
            await submit_slide_review(
                task_id, slide_id, principal, connection, BackgroundTasks(), NoRealtime()
            )


async def seed_gallery_tour(
    connection: AsyncConnection,
    seeded: Seeded,
    store: ObjectStore,
    results: ResultStore,
    manifest: Mapping[str, Mapping[str, Any]],
    gallery: str,
) -> None:
    assert seeded.owner is not None
    try:
        await store.put_new_object(
            f"{sample_folder(VIEWER_SAMPLE)}{RESTRICTED_RANGES_NAME}",
            json.dumps(VIEWER_SAMPLE_RANGES).encode(),
            "application/json",
        )
    except StorageError as error:
        if error.status != ALREADY_STORED:
            raise
    project_id = await connection.scalar(
        select(projects.c.id).where(
            projects.c.tenant_id == seeded.tenant_id, projects.c.name == gallery
        )
    )
    if project_id is None:
        return
    toured = await connection.scalar(
        select(review_tasks.c.id).where(
            review_tasks.c.project_id == project_id, review_tasks.c.name == GALLERY_TOUR
        )
    )
    if toured is not None:
        return
    await connection.execute(
        upsert(project_members)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=project_id,
            user_id=seeded.owner,
            role=ProjectRole.OWNER,
        )
        .on_conflict_do_nothing()
    )
    facts = viewer_sample_facts(manifest)
    sample_id = await connection.scalar(
        select(slides.c.id).where(
            slides.c.project_id == project_id, slides.c.original_key == facts["original_key"]
        )
    )
    if sample_id is None:
        sample_id = (await add_slide(connection, seeded, project_id, VIEWER_SAMPLE, facts)).id
    gallery_ids = await connection.scalars(
        select(slides.c.id)
        .where(slides.c.project_id == project_id, slides.c.id != sample_id)
        .order_by(slides.c.width.is_(None), slides.c.label)
    )
    templates = await built_in_templates(connection, seeded.tenant_id)
    await connection.execute(
        update(projects)
        .where(projects.c.id == project_id)
        .values(study_template_id=templates[BuiltInTemplate.DETECTION])
    )
    principal = principal_of(seeded, "ada", Role.RESEARCHER, True)
    demo = DemoSets({}, {})
    for slide_id in [sample_id, *gallery_ids]:
        await add_demo_sets(connection, principal, results, slide_id, demo)
    regions_of = demo.regions
    owner = [seeded.owner]
    detection = templates[BuiltInTemplate.DETECTION]
    await review_task(
        connection,
        principal,
        results,
        project_id,
        GALLERY_TOUR,
        regions_of,
        owner,
        DecisionStyle.AGREE,
        template_id=detection,
    )
    cell_tour = await review_task(
        connection,
        principal,
        results,
        project_id,
        CELL_TOUR,
        demo.cells,
        owner,
        DecisionStyle.AGREE,
        template_id=templates[BuiltInTemplate.CELL_TYPING],
        scope=Scope(kind=TaskScope.RANDOM_CELLS, count=CELLS_CHECKED),
    )
    await order_now(connection, results, cell_tour, list(demo.cells))
    ordered = list(regions_of)
    half_done = await review_task(
        connection,
        principal,
        results,
        project_id,
        HALF_DONE,
        {slide_id: regions_of[slide_id] for slide_id in ordered[:4]},
        owner,
        DecisionStyle.AGREE,
        template_id=detection,
    )
    submitted = await review_task(
        connection,
        principal,
        results,
        project_id,
        SUBMITTED,
        {slide_id: regions_of[slide_id] for slide_id in ordered[:2]},
        owner,
        DecisionStyle.AGREE,
        template_id=detection,
    )
    await review_task(
        connection,
        principal,
        results,
        project_id,
        ANNOTATE_DEMO,
        dict.fromkeys(ordered[:2]),
        owner,
        DecisionStyle.CERTAINTY,
        TaskKind.ANNOTATE,
    )
    owner_principal = MemberPrincipal(
        OWNER_SUBJECT, seeded.tenant_id, seeded.owner, Role.RESEARCHER, True
    )
    await decide_all(connection, owner_principal, results, half_done, ordered[:1], submit=True)
    await decide_all(connection, owner_principal, results, half_done, ordered[1:2], submit=False)
    await decide_all(connection, owner_principal, results, submitted, ordered[:2], submit=True)


async def seed_workspace(
    connection: AsyncConnection, organisation_id: uuid.UUID, workspace: Workspace
) -> Seeded:
    tenant_id = await new_tenant(connection, organisation_id, workspace)
    seeded = Seeded(tenant_id, {})
    for person in PEOPLE:
        seeded.people[person.key] = await add_member(
            connection,
            tenant_id,
            person.subject,
            person.name,
            person.initials,
            person.role,
            admin_rights=person.admin_rights,
        )
    return seeded


async def seed_projects(
    connection: AsyncConnection,
    workspace: Workspace,
    seeded: Seeded,
    store: ObjectStore,
    results: ResultStore,
    manifest: Mapping[str, Mapping[str, Any]],
) -> None:
    principal = principal_of(seeded, "ada", Role.RESEARCHER, True)
    samples = [await stored_sample_file(store, label) for label in SAMPLE_SLIDES]
    sample = next((found for found in samples if found is not None), None)
    for mode in PrivacyMode:
        project = await create_project(
            ProjectDraft(
                name=workspace.clinical_study if mode is PrivacyMode.CLINICAL else workspace.study,
                privacy_mode=mode,
                template=AnalysisTemplate.SENTINEL_NODE,
                taxonomy=TaxonomyTemplate.SENTINEL_NODE,
            ),
            principal,
            connection,
        )
        await join(
            connection,
            seeded,
            project.id,
            {
                "rui": ProjectRole.OWNER,
                "rhea": ProjectRole.REVIEWER,
                "remy": ProjectRole.REVIEWER,
                "vic": ProjectRole.VIEWER,
            },
        )
        if mode is PrivacyMode.DE_IDENTIFIED:
            job_ids = await add_jobs(connection, seeded, project.id)
            await seed_states(connection, seeded, principal, results, project.id, sample, job_ids)
            await seed_styles(connection, seeded, principal, results, project.id, sample)
    await seed_gallery(connection, seeded, principal, store, manifest, workspace.gallery)


async def seed(
    database_url: str,
    store: ObjectStore,
    results: ResultStore,
    owner_email: str | None,
    manifest: Mapping[str, Mapping[str, Any]] | None = None,
) -> list[uuid.UUID]:
    engine = create_engine(database_url)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(platform=True, auth=True)
        ) as connection:
            await lock(connection)
            organisation_id = await organisation(connection)
            tenant_ids: list[uuid.UUID] = []
            owners: dict[uuid.UUID, uuid.UUID] = {}
            created: list[tuple[uuid.UUID, Workspace]] = []
            for workspace in WORKSPACES:
                tenant_id = await existing_tenant(connection, workspace.slug)
                if tenant_id is None:
                    tenant_id = (
                        await seed_workspace(connection, organisation_id, workspace)
                    ).tenant_id
                    created.append((tenant_id, workspace))
                tenant_ids.append(tenant_id)
            if owner_email:
                for tenant_id in reversed(tenant_ids):
                    owners[tenant_id] = await add_owner(connection, tenant_id, owner_email)
        facts = manifest if manifest is not None else fixture_facts()
        for tenant_id, workspace in created:
            people = await people_of(engine, tenant_id)
            async with scoped_transaction(
                engine, DatabaseScope(tenant_id=tenant_id, user_id=people["ada"])
            ) as connection:
                await seed_projects(
                    connection, workspace, Seeded(tenant_id, people), store, results, facts
                )
        for tenant_id, workspace in zip(tenant_ids, WORKSPACES, strict=True):
            owner = owners.get(tenant_id)
            if owner is None:
                continue
            people = await people_of(engine, tenant_id)
            async with scoped_transaction(
                engine, DatabaseScope(tenant_id=tenant_id, user_id=people["ada"])
            ) as connection:
                await seed_gallery_tour(
                    connection,
                    Seeded(tenant_id, people, owner),
                    store,
                    results,
                    facts,
                    workspace.gallery,
                )
        return tenant_ids
    finally:
        await engine.dispose()


async def people_of(engine: Any, tenant_id: uuid.UUID) -> dict[str, uuid.UUID]:
    async with scoped_transaction(engine, DatabaseScope(platform=True, auth=True)) as connection:
        rows = await connection.execute(
            select(users.c.id, users.c.subject).where(
                users.c.subject.in_([person.subject for person in PEOPLE])
            )
        )
        by_subject = {row.subject: row.id for row in rows}
    return {person.key: by_subject[person.subject] for person in PEOPLE}


async def main() -> None:
    parser = argparse.ArgumentParser(
        prog="parfocal_api.showcase",
        description="Seed the ČVUT workspaces with invented people over every feature",
    )
    parser.parse_args()
    database_url = os.environ["DATABASE_URL"]
    settings = StorageSettings(app_env=AppEnv(os.environ.get("APP_ENV", AppEnv.DEV)))
    async with httpx2.AsyncClient(timeout=60) as http:
        store = ObjectStore(settings.storage(), http)
        tenant_ids = await seed(
            database_url,
            store,
            ObjectResultStore(store),
            os.environ.get("SEED_OWNER_EMAIL") or None,
        )
    print(f"seeded {len(tenant_ids)} ČVUT workspaces")


if __name__ == "__main__":
    asyncio.run(main())
