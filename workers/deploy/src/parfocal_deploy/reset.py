import argparse
import asyncio
import os
import sys
from collections.abc import Mapping

import httpx2

from parfocal_api.tables import slides
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_deploy import neon
from parfocal_deploy.bootstrap import storage_endpoint
from parfocal_deploy.deploy import MIGRATE
from parfocal_deploy.environments import Environment, environment
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
KEPT_TABLES = frozenset({"alembic_version", "platform_operators"})
metadata = slides.metadata
SEED = ("uv", "run", "--package", "parfocal-api", "python", "-m", "parfocal_api.showcase")


def truncate_statement() -> str:
    names = sorted(table.name for table in metadata.sorted_tables if table.name not in KEPT_TABLES)
    return f"TRUNCATE {', '.join(names)} RESTART IDENTITY CASCADE"


async def empty_tenant_objects(location: StorageLocation) -> int:
    async with httpx2.AsyncClient(timeout=60) as http:
        store = ObjectStore(location, http)
        keys = [
            key for key in await store.list_keys(TENANT_PREFIX) if key.startswith(TENANT_PREFIX)
        ]
        for key in keys:
            await store.delete_object(key)
        return len(keys)


def storage_location(target: Environment, settings: Mapping[str, str]) -> StorageLocation:
    return StorageLocation(
        endpoint=storage_endpoint(settings["CLOUDFLARE_ACCOUNT_ID"]),
        region="auto",
        bucket=target.slide_bucket,
        access_key_id=settings["R2_ACCESS_KEY_ID"],
        secret_access_key=settings["R2_SECRET_ACCESS_KEY"],
    )


def reset(target: Environment, tools: Tools, local: Mapping[str, str]) -> int:
    settings = required(local, RESET_SETTINGS)
    project = settings["NEON_PROJECT_ID"]
    branch = neon.ensure_branch(tools.neon, project, target.neon_branch)
    database = neon.first_database(tools.neon, project, branch)
    direct = neon.owner_uri(tools.neon, project, branch, database, pooled=False)
    location = storage_location(target, settings)
    tools.run(MIGRATE, None, {"MIGRATION_DATABASE_URL": neon.engine_uri(direct)})
    tools.sql(direct, truncate_statement())
    removed = asyncio.run(empty_tenant_objects(location))
    tools.run(
        SEED,
        None,
        {
            "DATABASE_URL": neon.engine_uri(direct),
            "APP_ENV": target.app_env,
            "STORAGE_ENDPOINT": location.endpoint,
            "STORAGE_REGION": location.region,
            "STORAGE_BUCKET": location.bucket,
            "STORAGE_ACCESS_KEY_ID": location.access_key_id,
            "STORAGE_SECRET_ACCESS_KEY": location.secret_access_key,
            "SEED_OWNER_EMAIL": settings["SEED_OWNER_EMAIL"],
        },
    )
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
