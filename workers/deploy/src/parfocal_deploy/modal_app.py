import tomllib
from pathlib import Path
from typing import Any

import modal

from parfocal_common.repository import repository_root
from parfocal_deploy.image_locks import APP_LOCK
from parfocal_deploy.parse_sandbox import PARSE_SANDBOX_OPTIONS
from parfocal_ingest.settings import INGEST_MEMORY_LIMIT_MIB, INGEST_MEMORY_MIB

APP_NAME = "parfocal-api"
WEB_FUNCTION = "web"
INGEST_FUNCTION = "ingest"
EVENTS_FUNCTION = "events"
KEYS_SECRET = "parfocal-api-keys"
CONFIG_SECRET = "parfocal-api-config"
LOGIN_SECRET = "parfocal-api-login"
SECRETS = (KEYS_SECRET, CONFIG_SECRET, LOGIN_SECRET)
FUNCTION_SECRETS: dict[str, tuple[str, ...]] = {
    WEB_FUNCTION: SECRETS,
    INGEST_FUNCTION: SECRETS,
    EVENTS_FUNCTION: SECRETS,
}
PYTHON_VERSION = "3.14"
REPOSITORY = repository_root(__file__)
PROJECTS = ("packages/py-common", "apps/api", "workers/ingest")
SOURCES = ("parfocal_common", "parfocal_api", "parfocal_ingest", "parfocal_deploy")
WORKSPACE_PREFIX = "parfocal-"
INGEST_IDLE_EXIT_SECONDS = 30.0
MAX_DEPLOYED_CRONS = 5
PARSE_LAUNCHER = "parfocal_deploy.parse_sandbox:ingest_launcher"

WEB_ENDPOINT: dict[str, Any] = {"requires_proxy_auth": True}
WEB_CONCURRENCY: dict[str, int] = {"max_inputs": 10, "target_inputs": 8}
WEB_OPTIONS: dict[str, Any] = {
    "name": WEB_FUNCTION,
    "memory": (512, 2048),
    "min_containers": 0,
    "max_containers": 4,
    "scaledown_window": 300,
    "timeout": 300,
}
INGEST_OPTIONS: dict[str, Any] = {
    "name": INGEST_FUNCTION,
    "memory": (INGEST_MEMORY_MIB, INGEST_MEMORY_LIMIT_MIB),
    "min_containers": 0,
    "max_containers": 2,
    "scaledown_window": 60,
    "timeout": 3600,
}
EVENTS_PERIOD_MINUTES = 5
EVENTS_OPTIONS: dict[str, Any] = {
    "name": EVENTS_FUNCTION,
    "schedule": modal.Period(minutes=EVENTS_PERIOD_MINUTES),
    "min_containers": 0,
    "max_containers": 1,
    "timeout": 600,
}
__all__ = ["PARSE_SANDBOX_OPTIONS"]


def project_requirements(project: Path) -> list[str]:
    declared = tomllib.loads((project / "pyproject.toml").read_text())["project"]
    extras = [
        item for group in declared.get("optional-dependencies", {}).values() for item in group
    ]
    return [
        requirement
        for requirement in [*declared["dependencies"], *extras]
        if not requirement.startswith(WORKSPACE_PREFIX)
    ]


def app_image() -> modal.Image:
    base = modal.Image.debian_slim(python_version=PYTHON_VERSION)
    if not modal.is_local():
        return base
    return APP_LOCK.install(base).add_local_python_source(
        *SOURCES, copy=True, ignore=["**/__pycache__/**"]
    )


def serve() -> Any:
    from parfocal_api.app import create_app
    from parfocal_common.warm_gate import ModalPools, WarmGate

    app = create_app()
    pools = ModalPools()
    app.state.gpu_pools = pools
    app.state.warm_gate = WarmGate(pools)
    return app


def run_ingest() -> None:
    import asyncio
    import os
    import sys

    from parfocal_ingest.__main__ import main

    os.environ.setdefault("INGEST_PARSE_LAUNCHER", PARSE_LAUNCHER)
    sys.argv = ["parfocal_ingest", "--idle-exit", str(INGEST_IDLE_EXIT_SECONDS)]
    asyncio.run(main())


def run_events() -> None:
    from parfocal_api.event_delivery import main

    main()


def secrets_of(function: str) -> list[modal.Secret]:
    return [modal.Secret.from_name(name) for name in FUNCTION_SECRETS[function]]


IMAGE = app_image()
app = modal.App(APP_NAME, image=IMAGE)
web = app.function(**WEB_OPTIONS, secrets=secrets_of(WEB_FUNCTION))(
    modal.concurrent(**WEB_CONCURRENCY)(modal.asgi_app(**WEB_ENDPOINT)(serve))
)
ingest = app.function(**INGEST_OPTIONS, secrets=secrets_of(INGEST_FUNCTION))(run_ingest)
events = app.function(**EVENTS_OPTIONS, secrets=secrets_of(EVENTS_FUNCTION))(run_events)
FUNCTIONS: dict[str, modal.Function] = {
    WEB_FUNCTION: web,
    INGEST_FUNCTION: ingest,
    EVENTS_FUNCTION: events,
}
