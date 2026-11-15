import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from db_support import APP_URL, with_database
from workspace_support import make_workspace

from parfocal_api.observability import run_alert_cycle
from parfocal_api.tables import Role
from parfocal_common.alerting import OnCall
from parfocal_common.clients import MemoryEmailSender
from parfocal_common.db import async_database_url, create_engine, tenant_transaction
from parfocal_common.jobs import jobs
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
