from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx2
from sqlalchemy import ColumnElement, FromClause, and_, or_, select
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_common import ingest
from parfocal_common.alerting import SliName
from parfocal_common.db import DatabaseScope, scoped_transaction
from parfocal_common.jobs import Claimed, jobs
from parfocal_common.model_runs import KIND as MODEL_RUN
from parfocal_common.model_runs import RunScopeKind, model_runs
from parfocal_common.object_store import ObjectStore
from parfocal_common.settings import AppEnv, StorageSettings
from parfocal_common.sli_store import ObjectBlobs, SliEmitter

JOB_SLIS: dict[str, SliName] = {
    ingest.KIND: SliName.INGEST_TIME,
    MODEL_RUN: SliName.PRE_READ_TIME,
}
SETTLED_STATUSES = ("done", "failed")


def jobs_with_runs() -> FromClause:
    return jobs.outerjoin(model_runs, model_runs.c.job_id == jobs.c.id)


def counts_toward_an_slo() -> ColumnElement[bool]:
    return or_(
        jobs.c.kind == ingest.KIND,
        and_(
            jobs.c.kind == MODEL_RUN,
            model_runs.c.started_by_user_id.is_(None),
            model_runs.c.scope_kind == RunScopeKind.SLIDE.value,
        ),
    )


@dataclass(frozen=True)
class SettledJob:
    kind: str
    status: str
    created_at: datetime
    finished_at: datetime
    counted: bool


def observe_settled(emitter: SliEmitter, job: SettledJob) -> bool:
    sli = JOB_SLIS.get(job.kind)
    if sli is None or not job.counted or job.status not in SETTLED_STATUSES:
        return False
    emitter.observe(
        sli,
        ok=job.status == "done",
        duration=job.finished_at - job.created_at,
        attributes={"area": job.kind},
    )
    return True


async def settled_job(engine: AsyncEngine, job: Claimed) -> SettledJob | None:
    async with scoped_transaction(engine, DatabaseScope(tenant_id=job.tenant_id)) as connection:
        row = (
            await connection.execute(
                select(
                    jobs.c.kind,
                    jobs.c.status,
                    jobs.c.created_at,
                    jobs.c.finished_at,
                    counts_toward_an_slo().label("counted"),
                )
                .select_from(jobs_with_runs())
                .where(jobs.c.id == job.job_id)
            )
        ).one_or_none()
    if row is None or row.finished_at is None:
        return None
    return SettledJob(row.kind, row.status, row.created_at, row.finished_at, bool(row.counted))


type SettledReader = Callable[[Claimed], Awaitable[SettledJob | None]]


@dataclass(frozen=True)
class JobSli:
    emitter: SliEmitter
    read: SettledReader

    async def __call__(self, job: Claimed) -> None:
        if job.kind not in JOB_SLIS:
            return
        settled = await self.read(job)
        if settled is not None and observe_settled(self.emitter, settled):
            await self.emitter.flush()


def job_sli(engine: AsyncEngine, emitter: SliEmitter) -> JobSli:
    async def read(job: Claimed) -> SettledJob | None:
        return await settled_job(engine, job)

    return JobSli(emitter, read)


def worker_sli(settings: StorageSettings, http: httpx2.AsyncClient) -> SliEmitter:
    blobs = (
        None
        if settings.app_env is AppEnv.TEST
        else ObjectBlobs(ObjectStore(settings.storage(), http))
    )
    return SliEmitter(lambda: datetime.now(UTC), blobs)
