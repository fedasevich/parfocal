import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, case, func, literal, null, select, union_all
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.model_catalogue import CATALOGUE
from parfocal_api.model_runs import require_run_reading
from parfocal_api.notifications import member_of
from parfocal_api.principals import MemberPrincipal
from parfocal_api.problems import ProblemError
from parfocal_api.projects import code_of as project_code
from parfocal_api.run_waits import PoolWatch, RunWait, pool_watch_of, run_waits
from parfocal_api.tables import project_members, projects, result_sets, slides, uploads
from parfocal_common.jobs import JobStatus, job_steps, job_units, jobs
from parfocal_common.model_runs import KIND as MODEL_RUN
from parfocal_common.model_runs import MODEL_STAGE, NUCLEI_DETECTORS, model_runs
from parfocal_common.result_imports import UploadKind

RECENT = 20


class MyJobKind(StrEnum):
    UPLOAD = "upload"
    MODEL_RUN = "model-run"
    IMPORT = "import"


class JobUnit(StrEnum):
    TILE = "tile"


IMPORT_STILL_WORKING = frozenset({JobStatus.QUEUED, JobStatus.RUNNING})


class JobPauseReason(StrEnum):
    SERVER_NOT_ANSWERING = "server-not-answering"
    SERVER_BUSY = "server-busy"


class JobProject(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class JobSlide(BaseModel):
    id: uuid.UUID
    label: str
    file: str


class JobPause(BaseModel):
    reason: JobPauseReason
    server: str
    since: datetime


class MyJob(BaseModel):
    id: uuid.UUID
    kind: MyJobKind
    title: str
    project: JobProject
    status: JobStatus
    error_code: str | None
    detail: str
    percent: int = Field(ge=0, le=100)
    minutes_left: int | None = Field(ge=0)
    units_done: int = Field(ge=0)
    units_total: int | None = Field(ge=0)
    unit: JobUnit | None
    started_by_user_id: uuid.UUID
    slides: list[JobSlide]
    pause: JobPause | None
    wait: RunWait | None
    created_at: datetime
    finished_at: datetime | None


router = APIRouter(prefix="/api/me", tags=["me"])


def started_by(me: uuid.UUID) -> Any:
    from_uploads = (
        select(
            uploads.c.job_id.label("job_id"),
            case(
                (uploads.c.kind == UploadKind.RESULT, literal(MyJobKind.IMPORT.value)),
                else_=literal(MyJobKind.UPLOAD.value),
            ).label("kind"),
            uploads.c.file_name.label("title"),
            func.coalesce(uploads.c.slide_id, slides.c.id).label("slide_id"),
            uploads.c.file_name.label("file"),
            result_sets.c.created_at.label("result_ready_at"),
        )
        .outerjoin(slides, slides.c.upload_id == uploads.c.id)
        .outerjoin(result_sets, result_sets.c.id == uploads.c.result_set_id)
        .where(uploads.c.created_by_user_id == me, uploads.c.job_id.is_not(None))
    )
    from_runs = select(
        model_runs.c.job_id,
        literal(MyJobKind.MODEL_RUN.value),
        func.concat(
            case(
                *[(model_runs.c.detector == model.name, model.title) for model in CATALOGUE],
                else_=model_runs.c.detector,
            ),
            " ",
            model_runs.c.detector_version,
        ),
        model_runs.c.slide_id,
        literal(""),
        null().cast(DateTime(timezone=True)),
    ).where(model_runs.c.started_by_user_id == me)
    return union_all(from_uploads, from_runs).subquery("started")


def counted_step() -> Any:
    return (jobs.c.kind != MODEL_RUN) | (job_steps.c.name == MODEL_STAGE)


def units_of() -> Any:
    done = (
        select(func.count())
        .select_from(job_units)
        .join(
            job_steps,
            (job_steps.c.job_id == job_units.c.job_id)
            & (job_steps.c.ordinal == job_units.c.ordinal),
        )
        .where(job_units.c.job_id == jobs.c.id, counted_step())
        .correlate(jobs)
        .scalar_subquery()
    )
    total = (
        select(
            case(
                (func.count().filter(job_steps.c.units_total.is_(None)) > 0, None),
                else_=func.sum(job_steps.c.units_total),
            )
        )
        .where(job_steps.c.job_id == jobs.c.id, counted_step())
        .correlate(jobs)
        .scalar_subquery()
    )
    return done.label("units_done"), total.label("units_total")


def unit_of(kind: MyJobKind) -> JobUnit | None:
    return JobUnit.TILE if kind is MyJobKind.MODEL_RUN else None


def shown_status(kind: MyJobKind, status: JobStatus, result_ready: bool) -> JobStatus:
    if kind is MyJobKind.IMPORT and result_ready and status in IMPORT_STILL_WORKING:
        return JobStatus.DONE
    return status


def percent_of(status: JobStatus, done: int, total: int | None) -> int:
    if status is JobStatus.DONE:
        return 100
    if not total:
        return 0
    return min(99, done * 100 // total)


def pause_of(row: Any, status: JobStatus) -> JobPause | None:
    if status is not JobStatus.PAUSED:
        return None
    reason = (
        JobPauseReason.SERVER_BUSY
        if row.pause_reason == JobPauseReason.SERVER_BUSY
        else JobPauseReason.SERVER_NOT_ANSWERING
    )
    return JobPause(reason=reason, server=row.title, since=row.created_at)


async def readable(connection: AsyncConnection, principal: MemberPrincipal, row: Any) -> bool:
    if row.kind != MyJobKind.MODEL_RUN:
        return True
    try:
        await require_run_reading(connection, principal, row.project_id, row.id)
    except ProblemError:
        return False
    return True


async def queued_on_the_pool(
    connection: AsyncConnection, rows: Sequence[Any]
) -> list[tuple[uuid.UUID, datetime]]:
    candidates = [
        row.id for row in rows if row.kind == MyJobKind.MODEL_RUN and row.status == JobStatus.QUEUED
    ]
    if not candidates:
        return []
    found = await connection.execute(
        select(jobs.c.id, jobs.c.created_at)
        .join(model_runs, model_runs.c.job_id == jobs.c.id)
        .where(
            jobs.c.id.in_(candidates),
            jobs.c.status == JobStatus.QUEUED,
            model_runs.c.detector.in_(NUCLEI_DETECTORS),
        )
    )
    return [(row.id, row.created_at) for row in found]


@router.get("/jobs", operation_id="listMyJobs")
async def list_my_jobs(
    principal: CurrentPrincipal,
    connection: TenantConnection,
    watch: Annotated[PoolWatch | None, Depends(pool_watch_of)],
) -> list[MyJob]:
    person = member_of(principal)
    started = started_by(person.user_id)
    done, total = units_of()
    rows = (
        await connection.execute(
            select(
                jobs.c.id,
                jobs.c.project_id,
                jobs.c.status,
                jobs.c.error_code,
                jobs.c.pause_reason,
                jobs.c.created_at,
                jobs.c.finished_at,
                started.c.kind,
                started.c.title,
                started.c.slide_id,
                started.c.file,
                started.c.result_ready_at,
                projects.c.number,
                projects.c.name.label("project_name"),
                slides.c.label.label("slide_label"),
                done,
                total,
            )
            .join(started, started.c.job_id == jobs.c.id)
            .join(projects, projects.c.id == jobs.c.project_id)
            .join(
                project_members,
                (project_members.c.project_id == projects.c.id)
                & (project_members.c.user_id == person.user_id),
            )
            .outerjoin(slides, (slides.c.id == started.c.slide_id) & slides.c.deleted_at.is_(None))
            .where(projects.c.archived_at.is_(None))
            .order_by(jobs.c.created_at.desc(), jobs.c.id)
            .limit(RECENT)
        )
    ).all()
    waits = await run_waits(watch, await queued_on_the_pool(connection, rows), datetime.now(UTC))
    found: list[MyJob] = []
    for row in rows:
        if not await readable(connection, person, row):
            continue
        kind = MyJobKind(row.kind)
        status = shown_status(kind, JobStatus(row.status), row.result_ready_at is not None)
        finished_at = row.finished_at
        if status is JobStatus.DONE and finished_at is None:
            finished_at = row.result_ready_at
        shown = (
            [JobSlide(id=row.slide_id, label=row.slide_label, file=row.file)]
            if row.slide_label is not None
            else []
        )
        code = project_code(row.number)
        found.append(
            MyJob(
                id=row.id,
                kind=kind,
                title=row.title,
                project=JobProject(id=row.project_id, code=code, name=row.project_name),
                status=status,
                error_code=row.error_code if status is JobStatus.FAILED else None,
                detail=f"{shown[0].label} in {code}" if shown else code,
                percent=percent_of(status, row.units_done, row.units_total),
                minutes_left=None,
                units_done=row.units_done,
                units_total=row.units_total,
                unit=unit_of(kind),
                started_by_user_id=person.user_id,
                slides=shown,
                pause=pause_of(row, status),
                wait=waits.get(row.id) if status is JobStatus.QUEUED else None,
                created_at=row.created_at,
                finished_at=finished_at,
            )
        )
    return found
