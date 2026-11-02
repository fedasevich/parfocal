import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from types import SimpleNamespace
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
from parfocal_api.model_catalogue import (
    BY_NAME,
    CATALOGUE,
    LAST_SAMPLES,
    PARFOCAL_SERVER,
    CatalogueModel,
    ModelHost,
    ModelMakes,
    QueuedRun,
    latest_version,
    queue_minutes,
    throughput,
)
from parfocal_api.permissions import Grant, Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import project_grant, readable_slide, require_slide_reading
from parfocal_api.projects import ProjectArchivedError, visible
from parfocal_api.result_sets import ResultSetDraft, insert_result_set
from parfocal_api.tables import (
    PrivacyMode,
    ResultSource,
    job_steps,
    job_units,
    jobs,
    model_runs,
    projects,
    result_sets,
    review_task_slides,
    review_tasks,
    slides,
    stage_throughput,
)
from parfocal_common.jobs import ALLOWED_FROM, JobControl, JobStatus, StepStatus, move
from parfocal_common.model_runs import KIND as MODEL_RUN
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


class ModelChoice(Closed):
    name: ModelName
    version: ModelVersion | None = None


class RunParameters(Closed):
    detector: ModelReference
    typer: ModelReference | None = None
    test_time_views: TestTimeViews = 1
    ordering: Ordering = Ordering.RASTER


class RunChoices(Closed):
    detector: ModelChoice
    typer: ModelChoice | None = None
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
    parameters: RunChoices

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
    waiting_reason: str | None = None


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
    result_set_id: uuid.UUID | None
    started_by_user_id: uuid.UUID | None
    attempts: int
    created_at: datetime
    finished_at: datetime | None
    stages: list[RunStage]
    actions: list[JobControl]


class ProjectModel(BaseModel):
    id: str
    name: str
    version: str
    title: str
    description: str
    makes: list[ModelMakes]
    minutes_per_slide: int
    measured: bool
    host: ModelHost
    server: str
    runs_ahead: int
    queue_minutes: int
    latency_ms: int | None


class ModelNotFoundError(BadRequestError):
    code = "model-not-found"
    title = "No model has this name. Give its version or pick a listed model"


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


def resolved(choice: ModelChoice) -> ModelReference:
    version = choice.version or latest_version(choice.name)
    if version is None:
        raise ModelNotFoundError(f"{choice.name!r} is not a Parfocal model")
    return ModelReference(name=choice.name, version=version)


def parameters_from(choices: RunChoices) -> RunParameters:
    return RunParameters(
        detector=resolved(choices.detector),
        typer=resolved(choices.typer) if choices.typer is not None else None,
        test_time_views=choices.test_time_views,
        ordering=choices.ordering,
    )


def settings_from(draft: ModelRunDraft, parameters: RunParameters) -> RunSettings:
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
    return (
        select(
            model_runs,
            jobs.c.status,
            jobs.c.error_code,
            jobs.c.pause_reason,
            jobs.c.claims,
            jobs.c.finished_at,
            result_sets.c.id.label("result_set_id"),
        )
        .join(jobs, jobs.c.id == model_runs.c.job_id)
        .outerjoin(
            result_sets,
            (result_sets.c.job_id == model_runs.c.job_id) & result_sets.c.deleted_at.is_(None),
        )
    )


def mark_waiting(stages: list[RunStage], reason: str | None) -> list[RunStage]:
    if reason is None:
        return stages
    waiting = next((item for item in stages if item.status is StepStatus.PENDING), None)
    return [
        item.model_copy(update={"waiting_reason": reason}) if item is waiting else item
        for item in stages
    ]


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
            result_set_id=row.result_set_id,
            started_by_user_id=row.started_by_user_id,
            attempts=row.claims,
            created_at=row.created_at,
            finished_at=row.finished_at,
            stages=mark_waiting(stages[row.job_id], row.pause_reason),
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


def result_set_draft(parameters: RunParameters) -> ResultSetDraft:
    detector = parameters.detector
    known = BY_NAME.get(detector.name)
    title = known.title if known is not None else detector.name
    return ResultSetDraft(name=f"{title} {detector.version}"[:120], model_version=detector.version)


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
    parameters = parameters_from(draft.parameters)
    settings = settings_from(draft, parameters)
    batch_id = uuid.uuid4()
    actor = actor_of(principal)
    job_ids: list[uuid.UUID] = []
    for slide_id in draft.slide_ids:
        job_id = await enqueue_model_run(
            connection,
            project.tenant_id,
            project_id,
            slide_id,
            settings,
            batch_id=batch_id,
            task_id=draft.task_id,
            started_by=started_by(principal),
        )
        result_set_id = await insert_result_set(
            connection,
            project.tenant_id,
            SimpleNamespace(id=slide_id, project_id=project_id),
            result_set_draft(parameters),
            ResultSource.RUN,
            actor,
            started_by(principal),
            job_id,
        )
        job_ids.append(job_id)
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
                "result_set_id": str(result_set_id),
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


def first_start() -> Any:
    return (
        select(func.min(job_steps.c.started_at))
        .where(job_steps.c.job_id == jobs.c.id)
        .scalar_subquery()
    )


async def measured_seconds(connection: AsyncConnection, model: CatalogueModel) -> list[float]:
    seconds = func.sum(stage_throughput.c.seconds)
    rows = await connection.scalars(
        select(seconds)
        .select_from(stage_throughput.join(jobs, jobs.c.id == stage_throughput.c.job_id))
        .where(
            jobs.c.status == JobStatus.DONE,
            stage_throughput.c.kind == MODEL_RUN,
            stage_throughput.c.model == model.name,
            stage_throughput.c.model_version == model.version,
        )
        .group_by(stage_throughput.c.job_id)
        .order_by(func.max(stage_throughput.c.finished_at).desc())
        .limit(LAST_SAMPLES)
    )
    return [float(value) for value in rows if value > 0]


async def runs_ahead(connection: AsyncConnection) -> list[QueuedRun]:
    started = first_start()
    rows = await connection.execute(
        select(model_runs.c.detector, jobs.c.status, started.label("started_at"))
        .join(jobs, jobs.c.id == model_runs.c.job_id)
        .where(jobs.c.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]))
    )
    return [
        QueuedRun(row.detector, row.started_at if row.status == JobStatus.RUNNING else None)
        for row in rows
    ]


@router.get(
    "/{project_id}/models",
    operation_id="listProjectModels",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_project_models(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[ProjectModel]:
    await visible(connection, principal, project_id)
    rates = {
        model.name: throughput(await measured_seconds(connection, model), model.nominal_minutes)
        for model in CATALOGUE
    }
    minutes = {name: rate.minutes_per_slide for name, rate in rates.items()}
    ahead = await runs_ahead(connection)
    now = datetime.now(UTC)
    return [
        ProjectModel(
            id=model.name,
            name=model.name,
            version=model.version,
            title=model.title,
            description=model.description,
            makes=list(model.makes),
            minutes_per_slide=rates[model.name].minutes_per_slide,
            measured=rates[model.name].measured,
            host=ModelHost.PARFOCAL,
            server=PARFOCAL_SERVER,
            runs_ahead=len(ahead),
            queue_minutes=queue_minutes(ahead, minutes, minutes[model.name], now),
            latency_ms=None,
        )
        for model in CATALOGUE
    ]
