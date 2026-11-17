import uuid
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.blinding import ai_hidden_on, require_ai_shown, sees_whole, user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.model_catalogue import ConfidenceBand, calibration_of
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import NotFoundError
from parfocal_api.result_sets import set_row
from parfocal_api.slide_coverage import readable_slide
from parfocal_api.tables import (
    AnnotationKind,
    annotations,
    job_steps,
    job_units,
    jobs,
    model_runs,
    project_classes,
    result_sets,
)
from parfocal_common.jobs import JobStatus, StepStatus

type StepKey = Literal["tissue", "regions", "cells"]
type StepState = Literal["done", "running", "queued"]

ACTIVE = (JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.PAUSED, JobStatus.CANCELLING)
STEP_OF_STAGE: tuple[tuple[StepKey, str], ...] = (
    ("tissue", "tissue-found"),
    ("regions", "model-running"),
    ("cells", "objects-placed"),
)
OBJECT_KINDS = (AnnotationKind.REGION, AnnotationKind.CELL)
UNCLASSED = "unclassed"
MEASUREMENTS = "measurements"


class AiStep(BaseModel):
    key: StepKey
    state: StepState
    percent: float = Field(ge=0, le=100)
    seconds: int | None = Field(ge=0)
    fragments: int | None = Field(ge=0)


class SlideAiProgress(BaseModel):
    slide_id: uuid.UUID
    state: Literal["running", "ready"]
    steps: list[AiStep]
    found: list[str]


class AnnotationLayer(BaseModel):
    key: str
    name: str
    class_name: str | None
    count: int = Field(ge=0)
    parent: str | None
    locked: bool


class AnnotationLayers(BaseModel):
    slide_id: uuid.UUID
    layers: list[AnnotationLayer]
    new_shapes_go_to: str


class BandAccuracy(BaseModel):
    confident: float | None = Field(default=None, ge=0, le=1)
    likely: float | None = Field(default=None, ge=0, le=1)
    unsure: float | None = Field(default=None, ge=0, le=1)
    doubtful: float | None = Field(default=None, ge=0, le=1)


class ResultSetTyper(BaseModel):
    result_set_id: uuid.UUID
    name: str
    calibrated: bool
    checked_on_held_out: bool
    band_accuracy: BandAccuracy
    test_set_accuracy: float | None = Field(ge=0, le=1)
    test_set_confident_share: float | None = Field(ge=0, le=1)
    test_set_unsure_share: float | None = Field(ge=0, le=1)
    validated_sites: list[str]


class NoTyperError(NotFoundError):
    code = "no-typer"
    title = "This result set has no cells, so no typer named their types"


slide_router = APIRouter(prefix="/api/slides/{slide_id}", tags=["slides"])
result_set_router = APIRouter(prefix="/api/result-sets/{result_set_id}", tags=["result-sets"])


def step_state(status: str | None) -> StepState:
    if status == StepStatus.DONE:
        return "done"
    if status == StepStatus.RUNNING:
        return "running"
    return "queued"


def step_seconds(row: Any) -> int | None:
    if row is None or row.status != StepStatus.DONE or row.started_at is None:
        return None
    if row.finished_at is None:
        return None
    return max(0, round((row.finished_at - row.started_at).total_seconds()))


def fragments_of(row: Any) -> int | None:
    found = row.result.get("fragments") if row is not None and row.result else None
    return found if isinstance(found, int) and found >= 0 else None


async def units_done(connection: AsyncConnection, job_id: uuid.UUID, ordinal: int) -> int:
    done = await connection.scalar(
        select(func.count()).where(
            job_units.c.job_id == job_id,
            job_units.c.ordinal == ordinal,
            job_units.c.result.is_not(None),
        )
    )
    return int(done or 0)


async def step_percent(connection: AsyncConnection, job_id: uuid.UUID, row: Any) -> float:
    if row is None:
        return 0.0
    if row.status == StepStatus.DONE:
        return 100.0
    if row.status != StepStatus.RUNNING or not row.units_total:
        return 0.0
    done = await units_done(connection, job_id, row.ordinal)
    return round(min(100.0, 100 * done / row.units_total), 1)


async def active_run(connection: AsyncConnection, slide_id: uuid.UUID) -> uuid.UUID | None:
    return await connection.scalar(
        select(model_runs.c.job_id)
        .join(jobs, jobs.c.id == model_runs.c.job_id)
        .where(model_runs.c.slide_id == slide_id, jobs.c.status.in_(ACTIVE))
        .order_by(jobs.c.created_at.desc())
        .limit(1)
    )


@slide_router.get(
    "/ai-progress",
    operation_id="getSlideAiProgress",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_slide_ai_progress(
    slide_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> SlideAiProgress:
    slide = await readable_slide(connection, principal, slide_id)
    hidden = await ai_hidden_on(connection, principal, slide.project_id, slide_id)
    job_id = None if hidden else await active_run(connection, slide_id)
    if job_id is None:
        return SlideAiProgress(slide_id=slide_id, state="ready", steps=[], found=[])
    stages = {
        row.name: row
        for row in await connection.execute(select(job_steps).where(job_steps.c.job_id == job_id))
    }
    steps: list[AiStep] = []
    for key, stage in STEP_OF_STAGE:
        row = stages.get(stage)
        steps.append(
            AiStep(
                key=key,
                state=step_state(None if row is None else row.status),
                percent=await step_percent(connection, job_id, row),
                seconds=step_seconds(row),
                fragments=fragments_of(row) if key == "tissue" else None,
            )
        )
    return SlideAiProgress(slide_id=slide_id, state="running", steps=steps, found=[])


async def counted_annotations(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, slide_id: uuid.UUID
) -> list[Any]:
    query = (
        select(
            annotations.c.class_id,
            func.bool_or(annotations.c.kind.in_(OBJECT_KINDS)).label("object"),
            func.count().label("shapes"),
        )
        .where(annotations.c.slide_id == slide_id, annotations.c.deleted_at.is_(None))
        .group_by(annotations.c.class_id, annotations.c.kind.in_(OBJECT_KINDS))
    )
    if not await sees_whole(connection, principal, project_id):
        me = user_of(principal)
        query = query.where(
            or_(annotations.c.task_id.is_(None), annotations.c.created_by_user_id == me)
            if me is not None
            else annotations.c.task_id.is_(None)
        )
    return list(await connection.execute(query))


@slide_router.get(
    "/annotation-layers",
    operation_id="listAnnotationLayers",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_annotation_layers(
    slide_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> AnnotationLayers:
    slide = await readable_slide(connection, principal, slide_id)
    classes = list(
        await connection.execute(
            select(project_classes.c.id, project_classes.c.name)
            .where(project_classes.c.project_id == slide.project_id)
            .order_by(project_classes.c.key)
        )
    )
    by_class: dict[uuid.UUID, int] = {}
    unclassed = 0
    measured = 0
    for row in await counted_annotations(connection, principal, slide.project_id, slide_id):
        if not row.object:
            measured += row.shapes
        elif row.class_id is None:
            unclassed += row.shapes
        else:
            by_class[row.class_id] = by_class.get(row.class_id, 0) + row.shapes
    layers = [
        AnnotationLayer(
            key=str(row.id),
            name=row.name,
            class_name=row.name,
            count=by_class.get(row.id, 0),
            parent=None,
            locked=False,
        )
        for row in classes
    ]
    if unclassed:
        layers.append(
            AnnotationLayer(
                key=UNCLASSED,
                name="No class",
                class_name=None,
                count=unclassed,
                parent=None,
                locked=False,
            )
        )
    if measured:
        layers.append(
            AnnotationLayer(
                key=MEASUREMENTS,
                name="Measurements",
                class_name=None,
                count=measured,
                parent=None,
                locked=False,
            )
        )
    return AnnotationLayers(
        slide_id=slide_id,
        layers=layers,
        new_shapes_go_to=layers[0].key if classes else "",
    )


def band_accuracy_of(accuracy: dict[ConfidenceBand, float]) -> BandAccuracy:
    return BandAccuracy.model_validate({str(band): share for band, share in accuracy.items()})


@result_set_router.get(
    "/typer",
    operation_id="getResultSetTyper",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_result_set_typer(
    result_set_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> ResultSetTyper:
    found = await set_row(connection, principal, result_set_id)
    await require_ai_shown(connection, principal, found.project_id, found.slide_id)
    if found.cell_count == 0:
        raise NoTyperError
    row = (
        await connection.execute(
            select(
                func.coalesce(model_runs.c.typer, model_runs.c.detector, result_sets.c.name).label(
                    "typer"
                ),
                func.coalesce(
                    model_runs.c.typer_version,
                    model_runs.c.detector_version,
                    result_sets.c.model_version,
                ).label("version"),
                func.coalesce(model_runs.c.test_time_views, 1).label("views"),
            )
            .outerjoin(model_runs, model_runs.c.job_id == result_sets.c.job_id)
            .where(result_sets.c.id == result_set_id)
        )
    ).one()
    calibration = (
        None if row.version is None else calibration_of(row.typer, row.version, int(row.views))
    )
    if calibration is None:
        return ResultSetTyper(
            result_set_id=result_set_id,
            name=row.typer,
            calibrated=False,
            checked_on_held_out=False,
            band_accuracy=BandAccuracy(),
            test_set_accuracy=None,
            test_set_confident_share=None,
            test_set_unsure_share=None,
            validated_sites=[],
        )
    return ResultSetTyper(
        result_set_id=result_set_id,
        name=row.typer,
        calibrated=True,
        checked_on_held_out=True,
        band_accuracy=band_accuracy_of(calibration.band_accuracy()),
        test_set_accuracy=calibration.test_set_accuracy,
        test_set_confident_share=calibration.test_set_confident_share,
        test_set_unsure_share=calibration.test_set_unsure_share,
        validated_sites=list(calibration.validated_sites),
    )
