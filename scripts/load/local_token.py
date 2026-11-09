import argparse
import asyncio
import os
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from load.target import LOCAL_HOSTS
from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import create_async_engine

from parfocal_api.auth import API_TOKEN_PREFIX, digest
from parfocal_api.permissions import ServiceScope
from parfocal_api.tables import (
    Plan,
    Region,
    TenantKind,
    api_tokens,
    organisations,
    service_accounts,
    tenants,
)
from parfocal_common.db import async_database_url

SLUG = "load-smoke"
TOKEN_HOURS = 2


def local_owner_url() -> str:
    url = os.environ.get("MIGRATION_DATABASE_URL", "")
    host = urlsplit(url).hostname or ""
    if host not in LOCAL_HOSTS:
        raise SystemExit("MIGRATION_DATABASE_URL must point at the local compose Postgres")
    return async_database_url(url)


async def mint() -> None:
    engine = create_async_engine(local_owner_url())
    token = f"{API_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
    async with engine.begin() as connection:
        organisation_id = await connection.scalar(
            insert(organisations).values(slug=SLUG, name=SLUG).returning(organisations.c.id)
        )
        tenant_id = await connection.scalar(
            insert(tenants)
            .values(
                organisation_id=organisation_id,
                slug=SLUG,
                name=SLUG,
                kind=TenantKind.RESEARCH,
                region=Region.EU,
                plan=Plan.PILOT,
            )
            .returning(tenants.c.id)
        )
        account_id = await connection.scalar(
            insert(service_accounts)
            .values(
                tenant_id=tenant_id,
                name=SLUG,
                scopes=[ServiceScope.SEE_SLIDES.value, ServiceScope.SEE_PEOPLE.value],
            )
            .returning(service_accounts.c.id)
        )
        await connection.execute(
            insert(api_tokens).values(
                tenant_id=tenant_id,
                service_account_id=account_id,
                token_hash=digest(token),
                expires_at=datetime.now(UTC) + timedelta(hours=TOKEN_HOURS),
            )
        )
    await engine.dispose()
    print(token)


async def remove() -> None:
    engine = create_async_engine(local_owner_url())
    async with engine.begin() as connection:
        tenant_ids = select(tenants.c.id).where(tenants.c.slug == SLUG).scalar_subquery()
        await connection.execute(delete(api_tokens).where(api_tokens.c.tenant_id == tenant_ids))
        await connection.execute(
            delete(service_accounts).where(service_accounts.c.tenant_id == tenant_ids)
        )
        await connection.execute(delete(tenants).where(tenants.c.slug == SLUG))
        await connection.execute(delete(organisations).where(organisations.c.slug == SLUG))
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Mint or remove a short-lived service token in the local compose database"
    )
    parser.add_argument("action", choices=["mint", "remove"])
    action = parser.parse_args().action
    asyncio.run(mint() if action == "mint" else remove())


if __name__ == "__main__":
    main()
