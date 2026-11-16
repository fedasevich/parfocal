import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from db_support import APP_URL, with_database
from workspace_support import make_project, make_slide, make_workspace

from parfocal_api.observability import JobRow, job_rows, run_alert_cycle
from parfocal_api.tables import Role
from parfocal_common.alerting import OnCall
from parfocal_common.clients import MemoryEmailSender
from parfocal_common.db import async_database_url, create_engine, tenant_transaction
from parfocal_common.job_sli import SettledJob, settled_job
from parfocal_common.jobs import Claimed, jobs
from parfocal_common.model_runs import KIND as MODEL_RUN
from parfocal_common.model_runs import RunScopeKind, RunSettings, enqueue_model_run
from parfocal_common.sli_store import AlertStateStore, MemoryBlobs

PAGES = "pages@example.test"


@pytest.mark.db
def test_stuck_ingest_jobs_page_once_and_watermarks_survive_a_cold_start(database: str) -> None:
    workspace = make_workspace(database, {"owner": Role.RESEARCHER})
    blobs = MemoryBlobs()
    outbox = MemoryEmailSender()

    async def go() -> list[tuple[str, ...]]:
        engine = create_engine(async_database_url(with_database(APP_URL, database)))
        now = datetime.now(UTC)
        try:
            async with tenant_transaction(engine, workspace.tenant_id) as connection:
                for minutes in (30, 25, 20):
                    await connection.execute(
                        jobs.insert().values(
                            tenant_id=workspace.tenant_id,
                            kind="ingest",
                            status="running",
                            created_at=now - timedelta(minutes=minutes),
                        )
                    )
            on_call = OnCall(outbox, PAGES, PAGES)
            first = await run_alert_cycle(AlertStateStore(blobs), on_call, now, engine)
            second = await run_alert_cycle(
                AlertStateStore(blobs), on_call, now + timedelta(minutes=5), engine
            )
            state = await AlertStateStore(blobs).load()
            assert workspace.tenant_id in state.watermarks
            return [first.firing, second.firing]
        finally:
            await engine.dispose()

    first, second = asyncio.run(go())
    assert "slo:ingest-time:page" in first
    assert second == first
    subjects = [message.subject for message in outbox.sent]
    assert subjects.count("[page] slo:ingest-time:page") == 1


@pytest.mark.db
def test_only_automatic_whole_slide_runs_count_as_pre_reads(database: str) -> None:
    workspace = make_workspace(database, {"owner": Role.RESEARCHER})
    project_id = make_project(database, workspace.tenant_id)
    slide_id = make_slide(database, workspace.tenant_id, project_id, "pre-read")
    person = workspace.people["owner"].user_id
    slide_scope = RunSettings(RunScopeKind.SLIDE, None, "matrix-detector", "1")

    def open_runs(rows: list[JobRow]) -> list[JobRow]:
        return [row for row in rows if row.kind == MODEL_RUN]

    async def go() -> tuple[list[JobRow], list[SettledJob | None]]:
        engine = create_engine(async_database_url(with_database(APP_URL, database)))
        try:
            earlier = open_runs(await job_rows(engine))
            async with tenant_transaction(engine, workspace.tenant_id) as connection:
                runs = [
                    await enqueue_model_run(
                        connection,
                        workspace.tenant_id,
                        project_id,
                        slide_id,
                        slide_scope,
                        batch_id=uuid.uuid4(),
                        started_by=started_by,
                    )
                    for started_by in (None, person)
                ]
            open_rows = [row for row in open_runs(await job_rows(engine)) if row not in earlier]
            async with tenant_transaction(engine, workspace.tenant_id) as connection:
                await connection.execute(
                    jobs.update()
                    .where(jobs.c.id.in_(runs))
                    .values(status="failed", finished_at=datetime.now(UTC))
                )
            read = [
                await settled_job(
                    engine, Claimed(job_id, workspace.tenant_id, project_id, MODEL_RUN)
                )
                for job_id in runs
            ]
            return open_rows, read
        finally:
            await engine.dispose()

    open_rows, (automatic, by_hand) = asyncio.run(go())
    assert [row.kind for row in open_rows] == [MODEL_RUN]
    assert automatic is not None
    assert automatic.counted
    assert automatic.status == "failed"
    assert by_hand is not None
    assert not by_hand.counted
