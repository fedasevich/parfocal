import argparse
import asyncio
import os
import socket
import uuid

from parfocal_common.db import create_engine
from parfocal_common.jobs import load_workflow, work
from parfocal_common.structured_logging import configure_logging


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
    workflows = [
        load_workflow(path) for path in arguments.workflow or ["parfocal_ingest.workflow:INGEST"]
    ]
    try:
        await work(
            engine,
            workflows,
            arguments.worker,
            arguments.idle_exit,
            arguments.poll,
            arguments.workspace,
        )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
