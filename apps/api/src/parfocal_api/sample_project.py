import uuid
from dataclasses import dataclass

from fastapi import APIRouter, BackgroundTasks, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, actor_of
from parfocal_api.class_templates import TaxonomyTemplate
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal
from parfocal_api.problems import ConflictError
from parfocal_api.projects import (
    IN_THIS_TENANT,
    LIVE,
    OnlyMembersCreateProjectsError,
    Project,
    ProjectDraft,
    audit,
    create_project,
    owned,
    project_of,
)
from parfocal_api.realtime import NoRealtime
from parfocal_api.result_sets import (
    RegionRow,
    ResultSetDraft,
    add_regions,
    finish,
    insert_result_set,
)
from parfocal_api.review_order import Results
from parfocal_api.review_tasks import Scope, SlideSet, TaskDraft, create_review_task
from parfocal_api.sample_files import stored_sample_file
from parfocal_api.tables import (
    AnalysisTemplate,
    PrivacyMode,
    ResultObjectKind,
    ResultSource,
    TaskScope,
    TaskSplit,
    projects,
    result_sets,
    review_tasks,
    slides,
)
from parfocal_common.object_store import ObjectStore

SAMPLE_NAME = "Sample · sentinel nodes"
SAMPLE_TASK = "Try a review"
SAMPLE_SLIDES = ("tumor_001", "tumor_002", "tumor_003", "normal_001")
TUMOR = "Tumor"


@dataclass(frozen=True)
class SampleModel:
    name: str
    version: str
    reviewed: bool
    offset: int


SAMPLE_MODELS = (
    SampleModel("CAMELYON tumor model", "v1.0", True, 0),
    SampleModel("PathoSAM + HoVer-NeXt", "v1.2", False, 400),
)
REGIONS_PER_SLIDE = 3


class NotASampleError(ConflictError):
    code = "not-a-sample"
    title = "Only the sample project can be deleted"


router = APIRouter(prefix="/api/projects", tags=["projects"])


def square(index: int, offset: int) -> str:
    left, top = 8000 + index * 6000 + offset, 12000 + offset
    right, bottom = left + 2500, top + 1800
    return f"POLYGON(({left} {top},{right} {top},{right} {bottom},{left} {bottom},{left} {top}))"


def regions(model: SampleModel) -> list[RegionRow]:
    return [
        RegionRow(
            kind=ResultObjectKind.REGION,
            number=index + 1,
            wkt=square(index, model.offset),
            class_position=0,
            score=230 - index * 60,
        )
        for index in range(REGIONS_PER_SLIDE)
    ]


async def live_sample(connection: AsyncConnection) -> uuid.UUID | None:
    return await connection.scalar(
        select(projects.c.id).where(IN_THIS_TENANT, LIVE, projects.c.sample.is_(True))
    )


async def seed_slides(
    connection: AsyncConnection, store: ObjectStore, tenant_id: uuid.UUID, project_id: uuid.UUID
) -> list[uuid.UUID]:
    created: list[uuid.UUID] = []
    for label in SAMPLE_SLIDES:
        stored = await stored_sample_file(store, label)
        file = {} if stored is None else {**stored.model_dump(), "published_at": func.now()}
        slide_id = await connection.scalar(
            slides.insert()
            .values(tenant_id=tenant_id, project_id=project_id, label=label, stain="H&E", **file)
            .returning(slides.c.id)
        )
        assert isinstance(slide_id, uuid.UUID)
        created.append(slide_id)
    return created


async def seed_results(
    connection: AsyncConnection,
    principal: MemberPrincipal,
    project_id: uuid.UUID,
    slide_ids: list[uuid.UUID],
) -> dict[uuid.UUID, uuid.UUID]:
    reviewed: dict[uuid.UUID, uuid.UUID] = {}
    rows = (
        await connection.execute(
            select(slides.c.id, slides.c.project_id).where(slides.c.id.in_(slide_ids))
        )
    ).all()
    for slide in rows:
        for model in SAMPLE_MODELS:
            draft = ResultSetDraft(name=model.name, model_version=model.version, classes=[TUMOR])
            set_id = await insert_result_set(
                connection,
                principal.tenant_id,
                slide,
                draft,
                ResultSource.IMPORT,
                actor_of(principal),
                principal.user_id,
            )
            await add_regions(connection, set_id, regions(model))
            await finish(connection, set_id)
            if model.reviewed:
                reviewed[slide.id] = set_id
    return reviewed


async def seed(
    connection: AsyncConnection, store: ObjectStore, principal: MemberPrincipal, results: Results
) -> uuid.UUID:
    project = await create_project(
        ProjectDraft(
            name=SAMPLE_NAME,
            privacy_mode=PrivacyMode.DE_IDENTIFIED,
            template=AnalysisTemplate.SENTINEL_NODE,
            taxonomy=TaxonomyTemplate.SENTINEL_NODE,
        ),
        principal,
        connection,
    )
    await connection.execute(
        update(projects).where(projects.c.id == project.id).values(sample=True)
    )
    slide_ids = await seed_slides(connection, store, principal.tenant_id, project.id)
    reviewed = await seed_results(connection, principal, project.id, slide_ids)
    await create_review_task(
        project.id,
        TaskDraft(
            name=SAMPLE_TASK,
            slide_ids=slide_ids,
            result_sets=[
                SlideSet(slide_id=slide_id, result_set_id=reviewed[slide_id])
                for slide_id in slide_ids
            ],
            reviewer_ids=[principal.user_id],
            split=TaskSplit.EVERYONE,
            scope=Scope(kind=TaskScope.ALL_REGIONS),
            blinded=False,
        ),
        principal,
        connection,
        results,
        NoRealtime(),
        BackgroundTasks(),
    )
    await audit(
        connection,
        principal,
        AuditAction.SAMPLE_PROJECT_CREATED,
        project.id,
        {"slides": len(slide_ids), "result_sets": len(slide_ids) * len(SAMPLE_MODELS)},
    )
    return project.id


@router.post(
    "/sample",
    operation_id="createSampleProject",
    status_code=201,
    responses={200: {"description": "The workspace already has a sample project"}},
    **require(Permission.CREATE_CASES, write=True),
)
async def create_sample_project(
    response: Response,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
    results: Results,
) -> Project:
    if not isinstance(principal, MemberPrincipal):
        raise OnlyMembersCreateProjectsError
    await connection.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(f"sample-project:{principal.tenant_id}", 0)
            )
        )
    )
    existing = await live_sample(connection)
    if existing is not None:
        response.status_code = 200
        return await project_of(connection, principal, existing)
    return await project_of(
        connection, principal, await seed(connection, store, principal, results)
    )


@router.delete(
    "/{project_id}",
    operation_id="deleteProject",
    status_code=204,
    **require(Permission.CREATE_CASES, write=True),
)
async def delete_project(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> None:
    row = await owned(connection, principal, project_id)
    if not row.sample:
        raise NotASampleError
    gone = func.now()
    await connection.execute(
        update(review_tasks)
        .where(review_tasks.c.project_id == project_id, review_tasks.c.archived_at.is_(None))
        .values(archived_at=gone)
    )
    for table in (result_sets, slides, projects):
        key = table.c.id if table is projects else table.c.project_id
        await connection.execute(
            update(table)
            .where(key == project_id, table.c.deleted_at.is_(None))
            .values(deleted_at=gone)
        )
    await audit(connection, principal, AuditAction.PROJECT_DELETED, project_id, {"sample": True})
