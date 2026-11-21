import argparse
import asyncio
import os
import sys
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Protocol

import httpx2

from parfocal_api.tables import slides
from parfocal_common.object_store import (
    ListedObject,
    ObjectStore,
    StorageError,
    StorageLocation,
)
from parfocal_deploy import neon
from parfocal_deploy.bootstrap import storage_endpoint
from parfocal_deploy.deploy import MIGRATE
from parfocal_deploy.environments import Environment, environment
from parfocal_deploy.modal_app import APP_NAME, INGEST_FUNCTION
from parfocal_deploy.tools import Tools, fetch, read, required, run, sql

RESET_SETTINGS = (
    "NEON_API_KEY",
    "NEON_PROJECT_ID",
    "CLOUDFLARE_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "SEED_OWNER_EMAIL",
)
TENANT_PREFIX = "t/"
BUCKET_LOCKED = "ObjectLockedByBucketPolicy"
KEPT_TABLES = frozenset({"alembic_version", "platform_operators"})
AUDIT_TABLE = "audit_events"
AUDIT_TRUNCATE_GUARD = "audit_events_no_truncate"
DELETE_CONCURRENCY = 32
LOCK_AGE = timedelta(days=7)
metadata = slides.metadata
SEED = ("uv", "run", "--package", "parfocal-api", "python", "-m", "parfocal_api.showcase")
PUBLISH_FIXTURES = (
    "uv",
    "run",
    "--package",
    "parfocal-ingest",
    "python",
    "-m",
    "parfocal_ingest.fixture_slides",
)


def truncate_statement() -> str:
    names = sorted(table.name for table in metadata.sorted_tables if table.name not in KEPT_TABLES)
    return f"TRUNCATE {', '.join(names)} RESTART IDENTITY CASCADE"


def reset_statement() -> str:
    guard = f"ALTER TABLE {AUDIT_TABLE} {{}} TRIGGER {AUDIT_TRUNCATE_GUARD}"
    return (
        "DO $$ BEGIN "
        f"EXECUTE '{guard.format('DISABLE')}'; "
        f"EXECUTE '{truncate_statement()}'; "
        f"EXECUTE '{guard.format('ENABLE')}'; "
        "END $$"
    )


async def empty_tenant_objects(location: StorageLocation, now: datetime | None = None) -> int:
    async with httpx2.AsyncClient(timeout=60) as http:
        store = ObjectStore(location, http)
        listed = [
            item
            for item in await store.list_objects(TENANT_PREFIX)
            if item.key.startswith(TENANT_PREFIX)
        ]
        keys = past_the_lock(listed, now or datetime.now(UTC))
        return await remove_unlocked(store, keys)


def past_the_lock(objects: Sequence[ListedObject], now: datetime) -> list[str]:
    cutoff = now - LOCK_AGE
    return [item.key for item in objects if item.modified is None or item.modified <= cutoff]


class Deleter(Protocol):
    async def delete_object(self, key: str) -> None: ...


async def remove_unlocked(
    store: Deleter, keys: Sequence[str], concurrency: int = DELETE_CONCURRENCY
) -> int:
    gate = asyncio.Semaphore(concurrency)

    async def remove(key: str) -> bool:
        async with gate:
            try:
                await store.delete_object(key)
            except StorageError as error:
                if error.code != BUCKET_LOCKED:
                    raise
                return False
            return True

    return sum(await asyncio.gather(*(remove(key) for key in keys)))


def storage_location(target: Environment, settings: Mapping[str, str]) -> StorageLocation:
    return StorageLocation(
        endpoint=storage_endpoint(settings["CLOUDFLARE_ACCOUNT_ID"], target.storage_jurisdiction),
        region="auto",
        bucket=target.slide_bucket,
        access_key_id=settings["R2_ACCESS_KEY_ID"],
        secret_access_key=settings["R2_SECRET_ACCESS_KEY"],
    )


def start_ingest(target: Environment) -> None:
    import modal

    modal.Function.from_name(
        APP_NAME, INGEST_FUNCTION, environment_name=target.modal_environment
    ).spawn()


@contextmanager
def phase(name: str) -> Iterator[None]:
    started = time.monotonic()
    try:
        yield
    finally:
        sys.stderr.write(f"reset: {name} took {time.monotonic() - started:.0f} s\n")
        sys.stderr.flush()


def reset(
    target: Environment,
    tools: Tools,
    local: Mapping[str, str],
    drain_jobs: Callable[[Environment], None] = start_ingest,
) -> int:
    settings = required(local, RESET_SETTINGS)
    project = settings["NEON_PROJECT_ID"]
    branch = neon.ensure_branch(tools.neon, project, target.neon_branch)
    database = neon.first_database(tools.neon, project, branch)
    direct = neon.owner_uri(tools.neon, project, branch, database, pooled=False)
    location = storage_location(target, settings)
    storage = {
        "APP_ENV": target.app_env,
        "STORAGE_ENDPOINT": location.endpoint,
        "STORAGE_REGION": location.region,
        "STORAGE_BUCKET": location.bucket,
        "STORAGE_ACCESS_KEY_ID": location.access_key_id,
        "STORAGE_SECRET_ACCESS_KEY": location.secret_access_key,
    }
    with phase("migrate"):
        tools.run(MIGRATE, None, {"MIGRATION_DATABASE_URL": neon.engine_uri(direct)})
    with phase("publish fixtures"):
        tools.run(PUBLISH_FIXTURES, None, storage)
    with phase("truncate"):
        tools.sql(direct, reset_statement())
    with phase("empty tenant objects"):
        removed = asyncio.run(empty_tenant_objects(location))
    with phase("seed"):
        tools.run(
            SEED,
            None,
            {
                **storage,
                "DATABASE_URL": neon.engine_uri(direct),
                "SEED_OWNER_EMAIL": settings["SEED_OWNER_EMAIL"],
                "SEED_VIEWER_EMAILS": local.get("SEED_VIEWER_EMAILS", ""),
                "SEED_AGENT_EMAILS": local.get("SEED_AGENT_EMAILS", ""),
            },
        )
    drain_jobs(target)
    return removed


def main() -> None:
    parser = argparse.ArgumentParser(prog="parfocal_deploy.reset")
    parser.add_argument("--env", default="production")
    parser.add_argument("--confirm", required=True)
    arguments = parser.parse_args()
    target = environment(arguments.env)
    if arguments.confirm != target.name:
        sys.exit(f"type the environment name {target.name} to confirm the reset")
    api_key = required(os.environ, ["NEON_API_KEY"])["NEON_API_KEY"]
    tools = Tools(run=run, read=read, sql=sql, neon=neon.http_transport(api_key), fetch=fetch)
    removed = reset(target, tools, os.environ)
    sys.stdout.write(
        f"{target.name}: emptied the app tables and {removed} tenant objects, seeded\n"
    )


if __name__ == "__main__":
    main()
