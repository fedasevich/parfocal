import json
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Any, Literal, Self

from fastapi import APIRouter, Query
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    TypeAdapter,
    model_validator,
)
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import MultiPolygonGeometry, PolygonGeometry, checked
from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import ai_hidden, ai_hidden_on
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Grant, Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import project_grant, readable_slide, require_slide_reading
from parfocal_api.projects import ProjectArchivedError, visible
from parfocal_api.tables import (
    PrivacyMode,
    job_steps,
    job_units,
    jobs,
    model_runs,
    projects,
    review_task_slides,
    review_tasks,
    slides,
)
from parfocal_common.jobs import ALLOWED_FROM, JobControl, JobStatus, StepStatus, move
from parfocal_common.model_runs import Ordering, RunScopeKind, RunSettings, enqueue_model_run
from parfocal_common.object_ids import Letter, ObjectIdError, parse

MAX_SLIDES = 200
MAX_OBJECTS = 10_000
MAX_PIXELS = 10_000_000
MAX_LISTED = 200
SELECTABLE = frozenset({Letter.REGION, Letter.CELL, Letter.ROI, Letter.ZONE})

type ModelName = Annotated[
    str,
    StringConstraints(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._/-]*$"),
]
type ModelVersion = Annotated[
    str,
    StringConstraints(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9][A-Za-z0-9._+-]*$"),
]
type PixelOffset = Annotated[StrictInt, Field(ge=0, le=MAX_PIXELS)]
type PixelLength = Annotated[StrictInt, Field(ge=1, le=MAX_PIXELS)]
type SelectionGeometry = Annotated[
    PolygonGeometry | MultiPolygonGeometry, Field(discriminator="type")
]
type ObjectReference = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)
]


def whole_number(value: object) -> object:
    if type(value) is not int:
        raise ValueError("Give a whole number")
    return value


type TestTimeViews = Annotated[Literal[1, 8], BeforeValidator(whole_number)]


class Closed(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ModelReference(Closed):
    name: ModelName
    version: ModelVersion


class RunParameters(Closed):
    detector: ModelReference
    typer: ModelReference | None = None
    test_time_views: TestTimeViews = 1
    ordering: Ordering = Ordering.RASTER

    @model_validator(mode="after")
    def views_need_a_typer(self) -> Self:
        if self.test_time_views != 1 and self.typer is None:
            raise ValueError("Test-time augmentation needs a typer")
        return self


class SlideScope(Closed):
    kind: Literal["slide"]


class ViewScope(Closed):
    kind: Literal["view"]
    x: PixelOffset
    y: PixelOffset
    width: PixelLength
    height: PixelLength


def selected_objects(texts: Sequence[str]) -> list[str]:
    chosen: dict[str, None] = {}
    for item in texts:
        try:
            object_id = parse(item)
        except ObjectIdError as error:
            raise ValueError(str(error)) from error
        if object_id.letter not in SELECTABLE:
            raise ValueError(f"{item!r} is not a region, cell, region of interest or zone")
        chosen[object_id.text(ascii=True)] = None
    return list(chosen)


class SelectionScope(Closed):
    kind: Literal["selection"]
    geometry: SelectionGeometry | None = None
    objects: (
        Annotated[list[ObjectReference], Field(min_length=1, max_length=MAX_OBJECTS)] | None
    ) = None

    @model_validator(mode="after")
    def one_selection(self) -> Self:
        if (self.geometry is None) == (self.objects is None):
            raise ValueError("A selection is either a geometry or a list of objects")
        if self.geometry is not None:
            checked(self.geometry)
        if self.objects is not None:
            self.objects = selected_objects(self.objects)
        return self


type RunScope = Annotated[SlideScope | ViewScope | SelectionScope, Field(discriminator="kind")]

SCOPES: TypeAdapter[SlideScope | ViewScope | SelectionScope] = TypeAdapter(RunScope)


class ModelRunDraft(Closed):
    slide_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=MAX_SLIDES)]
    task_id: uuid.UUID | None = None
    scope: RunScope
    parameters: RunParameters

    @model_validator(mode="after")
    def slides_fit_the_scope(self) -> Self:
        if len(set(self.slide_ids)) != len(self.slide_ids):
            raise ValueError("A slide is listed more than once")
        if self.scope.kind != "slide" and len(self.slide_ids) != 1:
            raise ValueError("A view or a selection belongs to exactly one slide")
        return self


class RunStage(BaseModel):
    name: str
    status: StepStatus
    runs: int
    units_done: int
    units_total: int | None
    started_at: datetime | None
    finished_at: datetime | None


class ModelRun(BaseModel):
    id: uuid.UUID
    batch_id: uuid.UUID
    project_id: uuid.UUID
    slide_id: uuid.UUID
    task_id: uuid.UUID | None
    status: JobStatus
    error_code: str | None
    pause_reason: str | None
    scope: RunScope
    parameters: RunParameters
    started_by_user_id: uuid.UUID | None
    attempts: int
    created_at: datetime
    finished_at: datetime | None
    stages: list[RunStage]
    actions: list[JobControl]


class SlideNotInProjectError(BadRequestError):
    code = "slide-not-in-project"
    title = "A slide is not in this project"


class TaskNotInProjectError(BadRequestError):
    code = "task-not-in-project"
    title = "The review task is not in this project"


class SlideNotInTaskError(BadRequestError):
    code = "slide-not-in-task"
    title = "A slide is not part of the review task"


class SelectionInvalidError(BadRequestError):
    code = "selection-invalid"
    title = "The selected shape is not valid"


class TaskArchivedError(ConflictError):
    code = "task-archived"
    title = "The review task is archived"


class ModelRunNotFoundError(NotFoundError):
    code = "model-run-not-found"
    title = "Model run not found"


class RunningModelsNotAllowedError(ForbiddenError):
    code = "running-models-not-allowed"
    title = "Only an owner of this project runs models and controls their runs"


class ModelRunNotCancellableError(ConflictError):
    code = "model-run-not-cancellable"
    title = "Only a queued, running or paused run can be cancelled"


class ModelRunNotResumableError(ConflictError):
    code = "model-run-not-resumable"
    title = "Only a paused or cancelled run can be resumed"


class ModelRunNotRetryableError(ConflictError):
    code = "model-run-not-retryable"
    title = "Only a failed run can be retried"


REFUSALS: dict[JobControl, type[ConflictError]] = {
    JobControl.CANCEL: ModelRunNotCancellableError,
    JobControl.RESUME: ModelRunNotResumableError,
    JobControl.RETRY: ModelRunNotRetryableError,
}
ACTIONS = {
    JobControl.CANCEL: AuditAction.MODEL_RUN_CANCELLED,
    JobControl.RESUME: AuditAction.MODEL_RUN_RESUMED,
    JobControl.RETRY: AuditAction.MODEL_RUN_RETRIED,
}

router = APIRouter(prefix="/api/projects", tags=["model-runs"])


def settings_from(draft: ModelRunDraft) -> RunSettings:
    parameters = draft.parameters
    scope = draft.scope.model_dump(mode="json", exclude={"kind"}, exclude_none=True)
    return RunSettings(
        scope_kind=RunScopeKind(draft.scope.kind),
        scope=None if draft.scope.kind == "slide" else scope,
        detector=parameters.detector.name,
        detector_version=parameters.detector.version,
        typer=parameters.typer.name if parameters.typer else None,
        typer_version=parameters.typer.version if parameters.typer else None,
        test_time_views=parameters.test_time_views,
        ordering=parameters.ordering,
    )


def parameters_of(row: Any) -> RunParameters:
    typer = (
        ModelReference(name=row.typer, version=row.typer_version) if row.typer is not None else None
    )
    return RunParameters(
        detector=ModelReference(name=row.detector, version=row.detector_version),
        typer=typer,
        test_time_views=row.test_time_views,
        ordering=Ordering(row.ordering),
    )


def scope_of(row: Any) -> SlideScope | ViewScope | SelectionScope:
    return SCOPES.validate_python({"kind": row.scope_kind, **(row.scope or {})})


def actions_for(status: JobStatus, controls: bool) -> list[JobControl]:
    if not controls:
        return []
    return [control for control in JobControl if status in ALLOWED_FROM[control]]


async def may_control(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID
) -> bool:
    return (
        await project_grant(connection, principal, project_id, Permission.RUN_MODELS) is Grant.ALL
    )


async def require_controlling(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, archived: bool
) -> None:
    if not await may_control(connection, principal, project_id):
        raise RunningModelsNotAllowedError
    if archived:
        raise ProjectArchivedError


async def stages_of(
    connection: AsyncConnection, job_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[RunStage]]:
    units = (
        select(func.count())
        .where(job_units.c.job_id == job_steps.c.job_id, job_units.c.ordinal == job_steps.c.ordinal)
        .scalar_subquery()
    )
    rows = await connection.execute(
        select(job_steps, units.label("units_done"))
        .where(job_steps.c.job_id.in_(list(job_ids)))
        .order_by(job_steps.c.job_id, job_steps.c.ordinal)
    )
    stages: dict[uuid.UUID, list[RunStage]] = {job_id: [] for job_id in job_ids}
    for row in rows:
        stages[row.job_id].append(
            RunStage(
                name=row.name,
                status=StepStatus(row.status),
                runs=row.runs,
                units_done=row.units_done,
                units_total=row.units_total,
                started_at=row.started_at,
                finished_at=row.finished_at,
            )
        )
    return stages


def run_query() -> Any:
    return select(
        model_runs,
        jobs.c.status,
        jobs.c.error_code,
        jobs.c.pause_reason,
        jobs.c.claims,
        jobs.c.finished_at,
    ).join(jobs, jobs.c.id == model_runs.c.job_id)


async def runs_of(
    connection: AsyncConnection, rows: Sequence[Any], controls: bool
) -> list[ModelRun]:
    stages = await stages_of(connection, [row.job_id for row in rows])
    return [
        ModelRun(
            id=row.job_id,
            batch_id=row.batch_id,
            project_id=row.project_id,
            slide_id=row.slide_id,
            task_id=row.task_id,
            status=JobStatus(row.status),
            error_code=row.error_code,
            pause_reason=row.pause_reason,
            scope=scope_of(row),
            parameters=parameters_of(row),
            started_by_user_id=row.started_by_user_id,
            attempts=row.claims,
            created_at=row.created_at,
            finished_at=row.finished_at,
            stages=stages[row.job_id],
            actions=actions_for(JobStatus(row.status), controls),
        )
        for row in rows
    ]


async def readable_run(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, job_id: uuid.UUID
) -> Any:
    row = (
        await connection.execute(
            run_query()
            .add_columns(projects.c.privacy_mode, projects.c.archived_at)
            .join(projects, projects.c.id == model_runs.c.project_id)
            .where(model_runs.c.job_id == job_id, model_runs.c.project_id == project_id)
        )
    ).one_or_none()
    if row is None:
        raise ModelRunNotFoundError
    await require_slide_reading(
        connection,
        principal,
        project_id,
        PrivacyMode(row.privacy_mode),
        row.slide_id,
        ModelRunNotFoundError.title,
    )
    if await ai_hidden_on(connection, principal, project_id, row.slide_id):
        raise ModelRunNotFoundError
    return row


async def require_run_reading(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, job_id: uuid.UUID
) -> None:
    await readable_run(connection, principal, project_id, job_id)


async def check_slides(
    connection: AsyncConnection, project_id: uuid.UUID, draft: ModelRunDraft
) -> None:
    found = set(
        await connection.scalars(
            select(slides.c.id).where(
                slides.c.project_id == project_id,
                slides.c.id.in_(draft.slide_ids),
                slides.c.deleted_at.is_(None),
            )
        )
    )
    if found != set(draft.slide_ids):
        raise SlideNotInProjectError
    if draft.task_id is None:
        return
    task = (
        await connection.execute(
            select(review_tasks.c.archived_at).where(
                review_tasks.c.id == draft.task_id, review_tasks.c.project_id == project_id
            )
        )
    ).one_or_none()
    if task is None:
        raise TaskNotInProjectError
    if task.archived_at is not None:
        raise TaskArchivedError
    in_task = set(
        await connection.scalars(
            select(review_task_slides.c.slide_id).where(
                review_task_slides.c.task_id == draft.task_id,
                review_task_slides.c.slide_id.in_(draft.slide_ids),
            )
        )
    )
    if in_task != set(draft.slide_ids):
        raise SlideNotInTaskError


async def check_selection(connection: AsyncConnection, scope: SelectionScope) -> None:
    if scope.geometry is None:
        return
    shape = json.dumps(scope.geometry.model_dump(mode="json"))
    valid = await connection.scalar(select(func.ST_IsValid(func.ST_GeomFromGeoJSON(shape))))
    if not valid:
        raise SelectionInvalidError


def started_by(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


@router.post(
    "/{project_id}/model-runs",
    status_code=201,
    operation_id="startModelRuns",
    **require(Permission.RUN_MODELS, write=True),
)
async def start_model_runs(
    project_id: uuid.UUID,
    draft: ModelRunDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[ModelRun]:
    project = await visible(connection, principal, project_id)
    await require_controlling(connection, principal, project_id, project.archived_at is not None)
    await check_slides(connection, project_id, draft)
    if isinstance(draft.scope, SelectionScope):
        await check_selection(connection, draft.scope)
    settings = settings_from(draft)
    batch_id = uuid.uuid4()
    job_ids = [
        await enqueue_model_run(
            connection,
            project.tenant_id,
            project_id,
            slide_id,
            settings,
            batch_id=batch_id,
            task_id=draft.task_id,
            started_by=started_by(principal),
        )
        for slide_id in draft.slide_ids
    ]
    for job_id, slide_id in zip(job_ids, draft.slide_ids, strict=True):
        await record(
            connection,
            actor_of(principal),
            AuditAction.MODEL_RUN_STARTED,
            AuditTarget.MODEL_RUN,
            job_id,
            tenant_id=project.tenant_id,
            details={
                "project_id": str(project_id),
                "slide_id": str(slide_id),
                "batch_id": str(batch_id),
                "task_id": str(draft.task_id) if draft.task_id else None,
                "scope": draft.scope.kind,
                "detector": f"{settings.detector}@{settings.detector_version}",
                "typer": (f"{settings.typer}@{settings.typer_version}" if settings.typer else None),
                "test_time_views": settings.test_time_views,
                "ordering": settings.ordering.value,
            },
        )
    rows = (
        await connection.execute(
            run_query()
            .where(model_runs.c.job_id.in_(job_ids))
            .order_by(model_runs.c.created_at, model_runs.c.job_id)
        )
    ).all()
    by_id = {row.job_id: row for row in rows}
    return await runs_of(connection, [by_id[job_id] for job_id in job_ids], True)


@router.get(
    "/{project_id}/model-runs",
    operation_id="listModelRuns",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_model_runs(
    project_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    status: Annotated[list[JobStatus] | None, Query()] = None,
    slide_id: uuid.UUID | None = None,
    batch_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LISTED)] = 50,
) -> list[ModelRun]:
    project = await visible(connection, principal, project_id)
    filters: list[ColumnElement[bool]] = [
        model_runs.c.project_id == project_id,
        readable_slide(principal, model_runs.c.project_id, model_runs.c.slide_id),
        ~ai_hidden(principal, model_runs.c.project_id, model_runs.c.slide_id),
    ]
    if status:
        filters.append(jobs.c.status.in_(status))
    if slide_id is not None:
        filters.append(model_runs.c.slide_id == slide_id)
    if batch_id is not None:
        filters.append(model_runs.c.batch_id == batch_id)
    if task_id is not None:
        filters.append(model_runs.c.task_id == task_id)
    rows = (
        await connection.execute(
            run_query()
            .where(*filters)
            .order_by(model_runs.c.created_at.desc(), model_runs.c.job_id)
            .limit(limit)
        )
    ).all()
    controls = project.archived_at is None and await may_control(connection, principal, project_id)
    return await runs_of(connection, rows, controls)


@router.get(
    "/{project_id}/model-runs/{run_id}",
    operation_id="getModelRun",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_model_run(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ModelRun:
    row = await readable_run(connection, principal, project_id, run_id)
    controls = row.archived_at is None and await may_control(connection, principal, project_id)
    return (await runs_of(connection, [row], controls))[0]


async def control_run(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    control: JobControl,
) -> ModelRun:
    row = await readable_run(connection, principal, project_id, run_id)
    await require_controlling(connection, principal, project_id, row.archived_at is not None)
    moved = await move(connection, run_id, control)
    if moved is None:
        raise ModelRunNotFoundError
    if moved.after is None:
        raise REFUSALS[control](f"The run is {moved.before}")
    await record(
        connection,
        actor_of(principal),
        ACTIONS[control],
        AuditTarget.MODEL_RUN,
        run_id,
        tenant_id=row.tenant_id,
        details={
            "project_id": str(project_id),
            "slide_id": str(row.slide_id),
            "from": moved.before.value,
            "to": moved.after.value,
        },
    )
    fresh = (await connection.execute(run_query().where(model_runs.c.job_id == run_id))).one()
    return (await runs_of(connection, [fresh], True))[0]


@router.post(
    "/{project_id}/model-runs/{run_id}/cancel",
    operation_id="cancelModelRun",
    **require(Permission.RUN_MODELS, write=True),
)
async def cancel_model_run(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ModelRun:
    return await control_run(connection, principal, project_id, run_id, JobControl.CANCEL)


@router.post(
    "/{project_id}/model-runs/{run_id}/resume",
    operation_id="resumeModelRun",
    **require(Permission.RUN_MODELS, write=True),
)
async def resume_model_run(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ModelRun:
    return await control_run(connection, principal, project_id, run_id, JobControl.RESUME)


@router.post(
    "/{project_id}/model-runs/{run_id}/retry",
    operation_id="retryModelRun",
    **require(Permission.RUN_MODELS, write=True),
)
async def retry_model_run(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ModelRun:
    return await control_run(connection, principal, project_id, run_id, JobControl.RETRY)
