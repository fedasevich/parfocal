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
from parfocal_api.principals import MemberPrincipal
from parfocal_api.projects import ProjectDraft, create_project
from parfocal_api.realtime import NoRealtime
from parfocal_api.result_sets import (
    RegionRow,
    ResultSetDraft,
    add_regions,
    fail,
    finish,
    insert_result_set,
)
from parfocal_api.review_tasks import Scope, SlideSet, TaskDraft, create_review_task
from parfocal_api.sample_files import SampleFile, stored_sample_file
from parfocal_api.sample_project import SAMPLE_SLIDES, square
from parfocal_api.study_templates import seed_built_ins
from parfocal_api.tables import (
    AnalysisTemplate,
    DecisionStyle,
    PrivacyMode,
    ProjectRole,
    ResultObjectKind,
    ResultSource,
    Role,
    TaskKind,
    TaskScope,
    TaskSplit,
    VerdictReason,
    VerdictValue,
    memberships,
    organisations,
    project_members,
    review_assignments,
    review_task_slides,
    review_tasks,
    slides,
    tenants,
    users,
    verdicts,
    workspace_settings,
)
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.jobs import JobStatus, jobs
from parfocal_common.object_store import ObjectStore
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


WORKSPACES = (
    Workspace("cvut-biomedical", "ČVUT · Biomedical Engineering"),
    Workspace("cvut-imaging", "ČVUT · Medical Imaging Group"),
    Workspace("cvut-ml", "ČVUT · Machine Learning Lab"),
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


@dataclass
class Seeded:
    tenant_id: uuid.UUID
    people: dict[str, uuid.UUID]


def fixture_facts(manifest: Path = FIXTURES_MANIFEST) -> dict[str, Mapping[str, Any]]:
    remote = json.loads(manifest.read_text())["remote"]
    return {entry["file"]: entry for entry in remote}


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


def gallery_facts(slide: GallerySlide, manifest: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    entry = manifest[slide.file]
    return {
        "format": slide.format,
        "variant": slide.variant,
        "file_bytes": int(entry["bytes"]),
        "sha256": str(entry["sha256"]),
        "original_key": f"{FIXTURE_PREFIX}{slide.file}",
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
        name="Showcase tumour model",
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
    value: VerdictValue,
    reasons: list[VerdictReason] | None = None,
) -> None:
    await connection.execute(
        insert(verdicts).values(
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
        await decide(connection, seeded, project_id, task_id, slide_id, key, VerdictValue.AGREE)
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
) -> uuid.UUID:
    reviewing = kind is TaskKind.REVIEW
    task = await create_review_task(
        project_id,
        TaskDraft(
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
            scope=Scope(kind=TaskScope.ALL_REGIONS) if reviewing else None,
            blinded=False,
            decision=DecisionSettings(style=style) if reviewing else None,
        ),
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
            connection, seeded, project_id, f"Showcase {state}", sample_facts(sample)
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
        "Showcase · every state",
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
        VerdictValue.UNSURE,
        [VerdictReason.NEED_SECOND_LOOK, VerdictReason.BORDER_UNCLEAR],
    )
    await agree_and_submit(connection, seeded, project_id, task_id, named["submitted"])
    await decide(
        connection, seeded, project_id, task_id, named["disagreement"], "rhea", VerdictValue.AGREE
    )
    await decide(
        connection,
        seeded,
        project_id,
        task_id,
        named["disagreement"],
        "remy",
        VerdictValue.DISAGREE,
        [VerdictReason.BOUNDARY_OFF],
    )
    await submit(connection, task_id, named["disagreement"])
    closed_id = await review_task(
        connection,
        principal,
        results,
        project_id,
        "Showcase · signed off",
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
        ResultSetDraft(name="Showcase broken import", source_file="broken.csv"),
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
            connection, seeded, project_id, f"Showcase {style} style", sample_facts(sample)
        )
        set_id = await ready_set(connection, principal, slide, "regions.parfocal.json")
        task_id = await review_task(
            connection,
            principal,
            results,
            project_id,
            f"Showcase · {style} decisions",
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
                VerdictValue.DISAGREE,
                [VerdictReason.BOUNDARY_OFF],
            )
    slide = await add_slide(
        connection, seeded, project_id, "Showcase annotate", sample_facts(sample)
    )
    await review_task(
        connection,
        principal,
        results,
        project_id,
        "Showcase · annotate",
        {slide.id: None},
        [seeded.people["rhea"]],
        DecisionStyle.CERTAINTY,
        TaskKind.ANNOTATE,
    )


async def seed_gallery(
    connection: AsyncConnection,
    seeded: Seeded,
    principal: MemberPrincipal,
    manifest: Mapping[str, Mapping[str, Any]],
) -> None:
    project = await create_project(
        ProjectDraft(name="Showcase · format gallery", privacy_mode=PrivacyMode.DE_IDENTIFIED),
        principal,
        connection,
    )
    await join(connection, seeded, project.id, {"rhea": ProjectRole.VIEWER})
    for slide in FORMAT_GALLERY:
        await add_slide(connection, seeded, project.id, slide.file, gallery_facts(slide, manifest))


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
                name=f"Showcase · {mode} review",
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
    await seed_gallery(connection, seeded, principal, manifest)


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
            created: list[uuid.UUID] = []
            for workspace in WORKSPACES:
                tenant_id = await existing_tenant(connection, workspace.slug)
                if tenant_id is None:
                    tenant_id = (
                        await seed_workspace(connection, organisation_id, workspace)
                    ).tenant_id
                    created.append(tenant_id)
                tenant_ids.append(tenant_id)
            if owner_email:
                for tenant_id in reversed(tenant_ids):
                    await add_owner(connection, tenant_id, owner_email)
        for tenant_id in created:
            people = await people_of(engine, tenant_id)
            ada = people["ada"]
            async with scoped_transaction(
                engine, DatabaseScope(tenant_id=tenant_id, user_id=ada)
            ) as connection:
                await seed_projects(
                    connection,
                    Seeded(tenant_id, people),
                    store,
                    results,
                    manifest if manifest is not None else fixture_facts(),
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
