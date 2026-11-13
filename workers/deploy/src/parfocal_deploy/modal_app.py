import tomllib
from pathlib import Path
from typing import Any

import modal

from parfocal_common.repository import repository_root
from parfocal_ingest.settings import INGEST_MEMORY_LIMIT_MIB, INGEST_MEMORY_MIB

APP_NAME = "parfocal-api"
WEB_FUNCTION = "web"
INGEST_FUNCTION = "ingest"
KEYS_SECRET = "parfocal-api-keys"
CONFIG_SECRET = "parfocal-api-config"
PYTHON_VERSION = "3.14"
REPOSITORY = repository_root(__file__)
PROJECTS = ("packages/py-common", "apps/api", "workers/ingest")
SOURCES = ("parfocal_common", "parfocal_api", "parfocal_ingest", "parfocal_deploy")
WORKSPACE_PREFIX = "parfocal-"
INGEST_IDLE_EXIT_SECONDS = 30.0
MAX_DEPLOYED_CRONS = 5

WEB_ENDPOINT: dict[str, Any] = {"requires_proxy_auth": True}
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


def requirements(repository: Path = REPOSITORY) -> list[str]:
    found = {
        requirement
        for project in PROJECTS
        for requirement in project_requirements(repository / project)
    }
    return sorted(found)


def app_image() -> modal.Image:
    base = modal.Image.debian_slim(python_version=PYTHON_VERSION)
    if not modal.is_local():
        return base
    return base.uv_pip_install(*requirements()).add_local_python_source(
        *SOURCES, ignore=["**/__pycache__/**"]
    )


def serve() -> Any:
    from parfocal_api.app import create_app

    return create_app()


def run_ingest() -> None:
    import asyncio
    import sys

    from parfocal_ingest.__main__ import main

    sys.argv = ["parfocal_ingest", "--idle-exit", str(INGEST_IDLE_EXIT_SECONDS)]
    asyncio.run(main())


app = modal.App(
    APP_NAME,
    image=app_image(),
    secrets=[modal.Secret.from_name(KEYS_SECRET), modal.Secret.from_name(CONFIG_SECRET)],
)
web = app.function(**WEB_OPTIONS)(modal.asgi_app(**WEB_ENDPOINT)(serve))
ingest = app.function(**INGEST_OPTIONS)(run_ingest)
FUNCTIONS: dict[str, modal.Function] = {WEB_FUNCTION: web, INGEST_FUNCTION: ingest}
