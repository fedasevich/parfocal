import importlib
import logging
import os
import subprocess
import time
import tomllib
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from pathlib import Path
from typing import Any

import modal

from parfocal_common.repository import repository_root
from parfocal_deploy.image_locks import APP_LOCK
from parfocal_deploy.parse_sandbox import PARSE_SANDBOX_OPTIONS
from parfocal_ingest.settings import INGEST_MEMORY_LIMIT_MIB, INGEST_MEMORY_MIB

APP_NAME = "parfocal-api"
WEB_FUNCTION = "web-eu"
WEB_REGION = "eu-west"
WORKER_REGION = "eu"
WEB_ROUTING_REGION = "eu-west"
INGEST_FUNCTION = "ingest"
EVENTS_FUNCTION = "events"
BACKFILL_FUNCTION = "backfill_thumbnails"
CROPS_BACKFILL_FUNCTION = "backfill_cell_crops"
LEVELS_BACKFILL_FUNCTION = "backfill_level_directories"
KEYS_SECRET = "parfocal-api-keys"
CONFIG_SECRET = "parfocal-api-config"
LOGIN_SECRET = "parfocal-api-login"
SECRETS = (KEYS_SECRET, CONFIG_SECRET, LOGIN_SECRET)
FUNCTION_SECRETS: dict[str, tuple[str, ...]] = {
    WEB_FUNCTION: SECRETS,
    INGEST_FUNCTION: SECRETS,
    EVENTS_FUNCTION: SECRETS,
    BACKFILL_FUNCTION: SECRETS,
    CROPS_BACKFILL_FUNCTION: SECRETS,
    LEVELS_BACKFILL_FUNCTION: SECRETS,
}
PYTHON_VERSION = "3.14"
REPOSITORY = repository_root(__file__)
PROJECTS = ("packages/py-common", "apps/api", "workers/ingest")
SOURCES = ("parfocal_common", "parfocal_api", "parfocal_ingest", "parfocal_deploy")
WORKSPACE_PREFIX = "parfocal-"
INGEST_IDLE_EXIT_SECONDS = 30.0
MAX_DEPLOYED_CRONS = 5
PARSE_LAUNCHER = "parfocal_deploy.parse_sandbox:ingest_launcher"
PRELOAD_VARIABLE = "PARFOCAL_PRELOAD"
WEB_PRELOAD = (
    "parfocal_api.app",
    "parfocal_api.event_emit",
    "parfocal_common.jobs",
    "parfocal_common.warm_gate",
    "sqlalchemy.dialects.postgresql.asyncpg",
    "asyncpg",
    "httpcore2",
    "h11",
    "truststore",
    "anyio._backends._asyncio",
    "encodings.idna",
    "concurrent.futures.thread",
)
STARTUP_LOGGER = "parfocal.api.startup"

WEB_ENDPOINT: dict[str, Any] = {"requires_proxy_auth": True}
WEB_CONCURRENCY: dict[str, int] = {"max_inputs": 20, "target_inputs": 16}
WEB_OPTIONS: dict[str, Any] = {
    "name": WEB_FUNCTION,
    "region": WEB_REGION,
    "routing_region": WEB_ROUTING_REGION,
    "memory": (512, 2048),
    "min_containers": 0,
    "max_containers": 4,
    "scaledown_window": 300,
    "timeout": 300,
    "enable_memory_snapshot": True,
}
INGEST_PERIOD_MINUTES = 60
INGEST_SPAWN_GAP_SECONDS = 15.0
INGEST_DRAINED_KINDS = frozenset(
    {
        "ingest",
        "result-import",
        "link-fetch",
        "remote-inspect",
        "remote-copy",
        "review-order",
        "patch-export",
        "cell-crops",
    }
)
INGEST_OPTIONS: dict[str, Any] = {
    "name": INGEST_FUNCTION,
    "region": WORKER_REGION,
    "memory": (INGEST_MEMORY_MIB, INGEST_MEMORY_LIMIT_MIB),
    "schedule": modal.Period(minutes=INGEST_PERIOD_MINUTES),
    "min_containers": 0,
    "max_containers": 2,
    "scaledown_window": 60,
    "timeout": 3600,
}
EVENTS_PERIOD_MINUTES = 60
EVENTS_LINGER_MINUTES = 35
EVENTS_SPAWN_GAP_SECONDS = 600.0
EVENTS_OPTIONS: dict[str, Any] = {
    "name": EVENTS_FUNCTION,
    "region": WORKER_REGION,
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


RELEASE_VARIABLE = "PARFOCAL_RELEASE"


def described_release() -> str:
    return subprocess.run(
        ["git", "describe", "--tags", "--always"],
        check=True,
        capture_output=True,
        text=True,
        cwd=REPOSITORY,
    ).stdout


def release_of(describe: Callable[[], str] = described_release) -> str | None:
    try:
        text = describe()
    except OSError, subprocess.CalledProcessError:
        return None
    return text.strip() or None


def web_image(image: modal.Image) -> modal.Image:
    settings = {PRELOAD_VARIABLE: WEB_FUNCTION}
    release = (os.environ.get(RELEASE_VARIABLE) or release_of()) if modal.is_local() else None
    if release:
        settings[RELEASE_VARIABLE] = release
    return image.env(settings)


def preload(
    environ: Mapping[str, str] = os.environ,
    load: Callable[[str], object] = importlib.import_module,
) -> None:
    if environ.get(PRELOAD_VARIABLE) == WEB_FUNCTION:
        for module in WEB_PRELOAD:
            load(module)


def elapsed_ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 1)


def timed_lifespan(
    lifespan: Callable[[Any], AbstractAsyncContextManager[Any]],
) -> Callable[[Any], AbstractAsyncContextManager[Any]]:
    @asynccontextmanager
    async def timed(app: Any) -> AsyncIterator[Any]:
        started = time.perf_counter()
        async with lifespan(app) as state:
            logging.getLogger(STARTUP_LOGGER).info(
                "web ready", extra={"lifespan_ms": elapsed_ms(started)}
            )
            yield state

    return timed


def serve() -> Any:
    started = time.perf_counter()
    import parfocal_api.app
    from parfocal_api.event_emit import set_waker
    from parfocal_common.jobs import set_job_waker
    from parfocal_common.warm_gate import ModalPools, WarmGate

    set_waker(spawn_events())
    set_job_waker(spawn_ingest())
    created = time.perf_counter()
    app = parfocal_api.app.create_app()
    pools = ModalPools()
    app.state.gpu_pools = pools
    app.state.warm_gate = WarmGate(pools)
    app.router.lifespan_context = timed_lifespan(app.router.lifespan_context)
    logging.getLogger(STARTUP_LOGGER).info(
        "web app created",
        extra={"serve_ms": elapsed_ms(started), "create_app_ms": elapsed_ms(created)},
    )
    return app


def run_ingest() -> None:
    import asyncio
    import os
    import sys

    from parfocal_ingest.__main__ import main

    os.environ.setdefault("INGEST_PARSE_LAUNCHER", PARSE_LAUNCHER)
    sys.argv = ["parfocal_ingest", "--idle-exit", str(INGEST_IDLE_EXIT_SECONDS)]
    asyncio.run(main())


def run_thumbnail_backfill() -> list[str]:
    from parfocal_ingest.thumbnail_backfill import main

    return main()


def run_cell_crops_backfill() -> None:
    from parfocal_ingest.cell_crops_backfill import main

    main()


def run_level_directories_backfill() -> dict[str, int]:
    from parfocal_ingest.level_directories_backfill import main

    return main()


def sweep_remote_caches() -> None:
    import asyncio

    from parfocal_api.remote_cache_sweep import run_once
    from parfocal_api.settings import ApiSettings
    from parfocal_common.settings import load_settings

    asyncio.run(run_once(load_settings(ApiSettings)))


def run_events(linger_minutes: int = 0) -> None:
    from parfocal_api.event_delivery import main

    main(["--linger-minutes", str(linger_minutes)])
    if linger_minutes == 0:
        sweep_remote_caches()


class EventSpawner:
    def __init__(
        self, spawn: Callable[[int], Awaitable[Any]], clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.spawn = spawn
        self.clock = clock
        self.last: float | None = None

    async def __call__(self) -> None:
        now = self.clock()
        if self.last is not None and now - self.last < EVENTS_SPAWN_GAP_SECONDS:
            return
        await self.spawn(EVENTS_LINGER_MINUTES)
        self.last = now


def spawn_events() -> Callable[[], Awaitable[None]]:
    function = modal.Function.from_name(APP_NAME, EVENTS_FUNCTION)
    return EventSpawner(function.spawn.aio)


class IngestSpawner:
    def __init__(
        self, spawn: Callable[[], Awaitable[Any]], clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.spawn = spawn
        self.clock = clock
        self.last: float | None = None

    async def __call__(self, kind: str) -> None:
        if kind not in INGEST_DRAINED_KINDS:
            return
        now = self.clock()
        if self.last is not None and now - self.last < INGEST_SPAWN_GAP_SECONDS:
            return
        await self.spawn()
        self.last = now


def spawn_ingest() -> Callable[[str], Awaitable[None]]:
    function = modal.Function.from_name(APP_NAME, INGEST_FUNCTION)
    return IngestSpawner(function.spawn.aio)


def secrets_of(function: str) -> list[modal.Secret]:
    return [modal.Secret.from_name(name) for name in FUNCTION_SECRETS[function]]


preload()
IMAGE = app_image()
app = modal.App(APP_NAME, image=IMAGE)
web = app.function(**WEB_OPTIONS, image=web_image(IMAGE), secrets=secrets_of(WEB_FUNCTION))(
    modal.concurrent(**WEB_CONCURRENCY)(modal.asgi_app(**WEB_ENDPOINT)(serve))
)
ingest = app.function(**INGEST_OPTIONS, secrets=secrets_of(INGEST_FUNCTION))(run_ingest)
events = app.function(**EVENTS_OPTIONS, secrets=secrets_of(EVENTS_FUNCTION))(run_events)
backfill_thumbnails = app.function(
    name=BACKFILL_FUNCTION,
    region=WORKER_REGION,
    memory=(INGEST_MEMORY_MIB, INGEST_MEMORY_LIMIT_MIB),
    timeout=3600,
    secrets=secrets_of(BACKFILL_FUNCTION),
)(run_thumbnail_backfill)
backfill_cell_crops = app.function(
    name=CROPS_BACKFILL_FUNCTION,
    region=WORKER_REGION,
    memory=(INGEST_MEMORY_MIB, INGEST_MEMORY_LIMIT_MIB),
    timeout=3600,
    secrets=secrets_of(CROPS_BACKFILL_FUNCTION),
)(run_cell_crops_backfill)
backfill_level_directories = app.function(
    name=LEVELS_BACKFILL_FUNCTION,
    region=WORKER_REGION,
    timeout=3600,
    secrets=secrets_of(LEVELS_BACKFILL_FUNCTION),
)(run_level_directories_backfill)
FUNCTIONS: dict[str, modal.Function] = {
    WEB_FUNCTION: web,
    INGEST_FUNCTION: ingest,
    EVENTS_FUNCTION: events,
    BACKFILL_FUNCTION: backfill_thumbnails,
    CROPS_BACKFILL_FUNCTION: backfill_cell_crops,
    LEVELS_BACKFILL_FUNCTION: backfill_level_directories,
}
