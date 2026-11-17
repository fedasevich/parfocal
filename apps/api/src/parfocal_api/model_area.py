import uuid
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import Text, cast, func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.hidden_models import hidden_names
from parfocal_api.lab_models import SampleTile, SentClass, host_of, project_rows_of
from parfocal_api.model_catalogue import CATALOGUE, PARFOCAL_SERVER
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError
from parfocal_api.projects import code_of, visible
from parfocal_api.tables import (
    jobs,
    lab_models,
    model_runs,
    projects,
    result_sets,
    slides,
)
from parfocal_common.jobs import JobStatus

LAB_TILES_AT_ONCE = 4
LAB_HEALTH_CHECK_MINUTES = 5
ACTIVE_RUN = (JobStatus.QUEUED, JobStatus.RUNNING)


class ModelRunDefaults(BaseModel):
    slide_ids: list[uuid.UUID]
    model_id: str


class AiModel(BaseModel):
    id: str
    name: str
    version: str
    source: Literal["parfocal", "lab"]
    catalogue_name: str | None
    makes: list[str]
    description: str
    runs_on: str
    who_can_run: str
    result_sets: int = Field(ge=0)
    shown: bool
    status: Literal["active", "answering", "offline", "imports-only", "hidden"]
    latency_ms: int | None


class ProjectRef(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class AiModelRun(BaseModel):
    id: uuid.UUID
    model: str
    project: ProjectRef
    slides: int = Field(ge=0)
    slides_done: int = Field(ge=0)
    started_by: uuid.UUID | None


class AiModels(BaseModel):
    models: list[AiModel]
    running: list[AiModelRun]


class LabTestModel(BaseModel):
    name: str
    version: str


class LabConnectionTest(BaseModel):
    outcome: Literal["untested", "follows-contract", "not-contract"]
    sample_slide: str
    returns: list[str]
    answered_ms: int | None
    server_software: str | None
    tiles: list[SampleTile]
    missing_geometry: int = Field(ge=0)
    model: LabTestModel | None
    classes: list[SentClass]


class LabModelConnection(BaseModel):
    address: str
    host: str
    sign_in: Literal["none", "token", "header"]
    last_four: str
    tile_size: int = Field(gt=0)
    magnification: int = Field(gt=0)
    tiles_at_once: int = Field(gt=0)
    health_check_minutes: int = Field(gt=0)
    taxonomy: str
    who_can_run: Literal["admins", "researchers"]
    project_ids: list[uuid.UUID]
    test: LabConnectionTest


class LabModelConnectionMissingError(NotFoundError):
    title = "No lab model is connected yet"
    code = "lab-model-not-connected"


project_router = APIRouter(prefix="/api/projects", tags=["model-runs"])
tenant_router = APIRouter(prefix="/api/tenant/models", tags=["tenant"])


@project_router.get(
    "/{project_id}/model-runs/defaults",
    operation_id="getModelRunDefaults",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_model_run_defaults(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> ModelRunDefaults:
    await visible(connection, principal, project_id)
    with_results = select(result_sets.c.slide_id).where(
        result_sets.c.project_id == project_id, result_sets.c.deleted_at.is_(None)
    )
    without = await connection.scalars(
        select(slides.c.id)
        .where(
            slides.c.project_id == project_id,
            slides.c.deleted_at.is_(None),
            slides.c.id.not_in(with_results),
        )
        .order_by(slides.c.created_at, slides.c.id)
    )
    hidden = await hidden_names(connection)
    shown = [model.name for model in CATALOGUE if model.name not in hidden]
    return ModelRunDefaults(
        slide_ids=list(without.all()), model_id=(shown or [CATALOGUE[0].name])[0]
    )


async def result_set_counts(connection: AsyncConnection) -> dict[str, int]:
    rows = await connection.execute(
        select(result_sets.c.name, func.count().label("count"))
        .where(result_sets.c.deleted_at.is_(None))
        .group_by(result_sets.c.name)
    )
    return {row.name: row.count for row in rows}


async def running_now(connection: AsyncConnection) -> list[AiModelRun]:
    done = func.count().filter(jobs.c.status == JobStatus.DONE)
    active = func.count().filter(jobs.c.status.in_(ACTIVE_RUN))
    rows = await connection.execute(
        select(
            model_runs.c.batch_id,
            model_runs.c.detector,
            model_runs.c.project_id,
            func.min(cast(model_runs.c.started_by_user_id, Text)).label("by"),
            func.count().label("slides"),
            done.label("done"),
            projects.c.number,
            projects.c.name,
        )
        .join(jobs, jobs.c.id == model_runs.c.job_id)
        .join(projects, projects.c.id == model_runs.c.project_id)
        .group_by(
            model_runs.c.batch_id,
            model_runs.c.detector,
            model_runs.c.project_id,
            projects.c.number,
            projects.c.name,
        )
        .having(active > 0)
        .order_by(model_runs.c.batch_id)
    )
    return [
        AiModelRun(
            id=row.batch_id,
            model=row.detector,
            project=ProjectRef(id=row.project_id, code=code_of(row.number), name=row.name),
            slides=row.slides,
            slides_done=row.done,
            started_by=None if row.by is None else uuid.UUID(row.by),
        )
        for row in rows
    ]


@tenant_router.get("", operation_id="listAiModels", **require(Permission.INTEGRATIONS))
async def list_ai_models(connection: TenantConnection) -> AiModels:
    hidden = await hidden_names(connection)
    counts = await result_set_counts(connection)
    parfocal = [
        AiModel(
            id=model.name,
            name=model.title,
            version=model.version,
            source="parfocal",
            catalogue_name=model.name,
            makes=[str(make) for make in model.makes],
            description=model.description,
            runs_on=PARFOCAL_SERVER,
            who_can_run="researchers",
            result_sets=counts.get(f"{model.title} {model.version}"[:120], 0),
            shown=model.name not in hidden,
            status="hidden" if model.name in hidden else "active",
            latency_ms=None,
        )
        for model in CATALOGUE
    ]
    rows = await connection.execute(select(lab_models).order_by(lab_models.c.created_at))
    lab = [
        AiModel(
            id=str(row.id),
            name=row.name,
            version=row.version,
            source="lab",
            catalogue_name=None,
            makes=[],
            description="",
            runs_on=host_of(row.address),
            who_can_run=row.who_can_run,
            result_sets=counts.get(f"{row.name} {row.version}"[:120], 0),
            shown=True,
            status="active",
            latency_ms=None,
        )
        for row in rows
    ]
    return AiModels(models=parfocal + lab, running=await running_now(connection))


@tenant_router.get(
    "/connection",
    operation_id="getLabModelConnection",
    **require(Permission.INTEGRATIONS),
)
async def get_lab_model_connection(connection: TenantConnection) -> LabModelConnection:
    row = (
        await connection.execute(
            select(lab_models).order_by(lab_models.c.created_at.desc(), lab_models.c.id).limit(1)
        )
    ).first()
    if row is None:
        raise LabModelConnectionMissingError
    chosen = await project_rows_of(connection, row.id)
    return LabModelConnection(
        address=row.address,
        host=host_of(row.address),
        sign_in=row.sign_in,
        last_four=row.secret_last_four or "",
        tile_size=row.tile_size,
        magnification=row.magnification,
        tiles_at_once=LAB_TILES_AT_ONCE,
        health_check_minutes=LAB_HEALTH_CHECK_MINUTES,
        taxonomy=row.taxonomy,
        who_can_run=row.who_can_run,
        project_ids=[project.project_id for project in chosen],
        test=LabConnectionTest(
            outcome="untested",
            sample_slide="",
            returns=[],
            answered_ms=None,
            server_software=None,
            tiles=[],
            missing_geometry=0,
            model=LabTestModel(name=row.name, version=row.version),
            classes=[],
        ),
    )
