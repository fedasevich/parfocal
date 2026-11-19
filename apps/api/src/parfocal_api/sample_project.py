import uuid
from functools import cache
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Response
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, actor_of
from parfocal_api.class_templates import TaxonomyTemplate
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal
from parfocal_api.projects import (
    IN_THIS_TENANT,
    LIVE,
    OnlyMembersCreateProjectsError,
    Project,
    ProjectDraft,
    audit,
    create_project,
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
from parfocal_api.sample_files import SampleFile, stored_facts
from parfocal_api.seed_request import seed_request
from parfocal_api.tables import (
    AnalysisTemplate,
    PrivacyMode,
    ResultObjectKind,
    ResultSource,
    TaskScope,
    TaskSplit,
    projects,
    slides,
)
from parfocal_common.ingest import fixture_folder
from parfocal_common.object_store import ObjectStore

SAMPLE_NAME = "Sample · sentinel nodes"
SAMPLE_TASK = "Try a review"
SAMPLE_SLIDES = ("tumor_001", "tumor_002", "tumor_003", "normal_001")
SAMPLE_MODEL = "CAMELYON tumor model"
SAMPLE_RESULTS = Path(__file__).with_name("sample_results.json")


class SampleRegion(BaseModel):
    wkt: str
    class_position: int
    score: int


class SampleSlide(BaseModel):
    label: str
    facts: SampleFile | None = None
    classes: list[str]
    regions: list[SampleRegion]


class SampleResults(BaseModel):
    model: str
    slides: list[SampleSlide]


router = APIRouter(prefix="/api/projects", tags=["projects"])


@cache
def sample_results() -> SampleResults:
    return SampleResults.model_validate_json(SAMPLE_RESULTS.read_bytes())


def regions(slide: SampleSlide) -> list[RegionRow]:
    return [
        RegionRow(
            kind=ResultObjectKind.REGION,
            number=number,
            wkt=region.wkt,
            class_position=region.class_position,
            score=region.score,
        )
        for number, region in enumerate(slide.regions, start=1)
    ]


async def live_sample(connection: AsyncConnection) -> uuid.UUID | None:
    return await connection.scalar(
        select(projects.c.id).where(IN_THIS_TENANT, LIVE, projects.c.sample.is_(True))
    )


async def seed_slides(
    connection: AsyncConnection, store: ObjectStore, tenant_id: uuid.UUID, project_id: uuid.UUID
) -> dict[uuid.UUID, SampleSlide]:
    created: dict[uuid.UUID, SampleSlide] = {}
    for slide in sample_results().slides:
        stored = slide.facts or await stored_facts(store, fixture_folder(slide.label))
        file = {} if stored is None else {**stored.model_dump(), "published_at": func.now()}
        slide_id = await connection.scalar(
            slides.insert()
            .values(
                tenant_id=tenant_id, project_id=project_id, label=slide.label, stain="H&E", **file
            )
            .returning(slides.c.id)
        )
        assert isinstance(slide_id, uuid.UUID)
        created[slide_id] = slide
    return created


async def seed_results(
    connection: AsyncConnection,
    principal: MemberPrincipal,
    project_id: uuid.UUID,
    seeded: dict[uuid.UUID, SampleSlide],
) -> dict[uuid.UUID, uuid.UUID]:
    reviewed: dict[uuid.UUID, uuid.UUID] = {}
    model = sample_results().model
    for slide_id, slide in seeded.items():
        row = (
            await connection.execute(
                select(slides.c.id, slides.c.project_id).where(slides.c.id == slide_id)
            )
        ).one()
        draft = ResultSetDraft(name=SAMPLE_MODEL, model_version=model, classes=slide.classes)
        set_id = await insert_result_set(
            connection,
            principal.tenant_id,
            row,
            draft,
            ResultSource.IMPORT,
            actor_of(principal),
            principal.user_id,
        )
        await add_regions(connection, set_id, regions(slide))
        await finish(connection, set_id)
        reviewed[slide_id] = set_id
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
    seeded = await seed_slides(connection, store, principal.tenant_id, project.id)
    reviewed = await seed_results(connection, principal, project.id, seeded)
    slide_ids = list(seeded)
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
        seed_request(),
    )
    await audit(
        connection,
        principal,
        AuditAction.SAMPLE_PROJECT_CREATED,
        project.id,
        {"slides": len(slide_ids), "result_sets": len(reviewed)},
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
