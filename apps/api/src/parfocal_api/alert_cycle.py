import asyncio
import logging
from datetime import UTC, datetime

import httpx2

from parfocal_api.app import PRODUCTION_FACTORIES
from parfocal_api.observability import CycleResult, run_alert_cycle
from parfocal_api.settings import ApiSettings
from parfocal_common.alerting import on_call_for
from parfocal_common.clients import select_clients
from parfocal_common.db import create_engine
from parfocal_common.object_store import ObjectStore
from parfocal_common.otlp import FlushingExporter
from parfocal_common.settings import load_settings
from parfocal_common.sli_store import AlertStateStore, ObjectBlobs
from parfocal_common.structured_logging import configure_logging

logger = logging.getLogger("parfocal.alerting")


async def cycle(settings: ApiSettings) -> CycleResult:
    clients = select_clients(settings, PRODUCTION_FACTORIES)
    engine = create_engine(str(settings.database_url))
    async with httpx2.AsyncClient(timeout=30) as http:
        try:
            return await run_alert_cycle(
                AlertStateStore(ObjectBlobs(ObjectStore(settings.storage(), http))),
                on_call_for(settings, clients),
                datetime.now(UTC),
                engine,
                clients.telemetry,
            )
        finally:
            if isinstance(clients.telemetry, FlushingExporter):
                await clients.telemetry.flush()
            await engine.dispose()


def main() -> None:
    settings = load_settings(ApiSettings)
    configure_logging("alerting", settings.app_env)
    result = asyncio.run(cycle(settings))
    logger.info("alert cycle finished", extra={"count": len(result.firing)})


if __name__ == "__main__":
    main()
