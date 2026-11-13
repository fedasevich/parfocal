import argparse
import asyncio
import os
import socket
import uuid

import httpx2

from parfocal_api.realtime import NoRealtime, RealtimeSettings, realtime_for
from parfocal_api.worklist_events import job_announcer
from parfocal_common.db import create_engine
from parfocal_common.jobs import load_workflow, work
from parfocal_common.structured_logging import configure_logging

DEFAULT_WORKFLOWS = (
    "parfocal_ingest.workflow:INGEST",
    "parfocal_ingest.result_import:RESULT_IMPORT",
    "parfocal_ingest.link_fetch:LINK_FETCH",
    "parfocal_api.review_order_job:REVIEW_ORDER",
    "parfocal_ingest.patch_export:PATCH_EXPORT",
)


def parse() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="parfocal_ingest", description="Run ingest jobs")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--workflow", action="append", default=[])
    parser.add_argument("--worker", default=f"{socket.gethostname()}:{os.getpid()}")
    parser.add_argument("--idle-exit", type=float, default=None)
    parser.add_argument("--poll", type=float, default=1.0)
    parser.add_argument("--workspace", type=uuid.UUID, default=None)
    return parser.parse_args()


async def main() -> None:
    arguments = parse()
    configure_logging("ingest", os.environ.get("APP_ENV", "dev"))
    engine = create_engine(arguments.database_url)
    workflows = [load_workflow(path) for path in arguments.workflow or DEFAULT_WORKFLOWS]
    http = httpx2.AsyncClient(timeout=5)
    live = realtime_for(RealtimeSettings(), http)
    try:
        await work(
            engine,
            workflows,
            arguments.worker,
            arguments.idle_exit,
            arguments.poll,
            arguments.workspace,
            None if isinstance(live, NoRealtime) else job_announcer(engine, live),
        )
    finally:
        await http.aclose()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
