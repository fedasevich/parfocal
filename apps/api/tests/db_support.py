import asyncio
import os
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from storage_support import TEST_MAX_BYTES, TEST_PAGE_SIZE, TEST_PART_BYTES, TEST_STORAGE

from parfocal_api.app import ParfocalApi, create_app
from parfocal_api.auth import authenticate
from parfocal_api.principals import Principal
from parfocal_api.problems import UnauthenticatedError
from parfocal_api.settings import ApiSettings
from parfocal_common.db import async_database_url

OWNER_URL = os.environ.get(
    "PARFOCAL_TEST_OWNER_URL", "postgresql://parfocal@localhost:5432/parfocal"
)
APP_URL = os.environ.get(
    "PARFOCAL_TEST_APP_URL", "postgresql://parfocal_app@localhost:6432/parfocal"
)
TEST_MASTER_KEYS = "test:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"
ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


def with_database(url: str, name: str) -> str:
    return f"{url.rsplit('/', 1)[0]}/{name}"


async def run_sql(url: str, statement: str) -> list[tuple[object, ...]]:
    engine = create_async_engine(async_database_url(url), isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as connection:
            result = await connection.execute(text(statement))
            return [tuple(row) for row in result.all()] if result.returns_rows else []
    finally:
        await engine.dispose()


def query(url: str, statement: str) -> list[tuple[object, ...]]:
    return asyncio.run(run_sql(url, statement))


def alembic_config(url: str) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.attributes["url"] = url
    return config


@contextmanager
def fresh_database() -> Generator[str]:
    name = f"parfocal_test_{uuid.uuid4().hex[:12]}"
    query(OWNER_URL, f"CREATE DATABASE {name}")
    try:
        yield name
    finally:
        query(OWNER_URL, f"DROP DATABASE {name} WITH (FORCE)")


def api_settings(database: str) -> ApiSettings:
    return ApiSettings.model_validate(
        {
            "app_env": "test",
            "database_url": with_database(APP_URL, database),
            "public_origin": "http://localhost:5173",
            "session_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            "master_keys": TEST_MASTER_KEYS,
            "zitadel_issuer": "https://issuer.invalid",
            "zitadel_client_id": "test",
            "zitadel_client_secret": "test",
            "storage_endpoint": TEST_STORAGE.endpoint,
            "storage_region": TEST_STORAGE.region,
            "storage_bucket": TEST_STORAGE.bucket,
            "storage_access_key_id": TEST_STORAGE.access_key_id,
            "storage_secret_access_key": TEST_STORAGE.secret_access_key,
            "upload_max_bytes": TEST_MAX_BYTES,
            "upload_part_bytes": TEST_PART_BYTES,
            "upload_list_page_size": TEST_PAGE_SIZE,
        }
    )


class ApiAs:
    def __init__(self, app: ParfocalApi, client: TestClient) -> None:
        self.app = app
        self.client = client
        self.principal: Principal | None = None
        app.dependency_overrides[authenticate] = self.current

    async def current(self) -> Principal:
        if self.principal is None:
            raise UnauthenticatedError
        return self.principal

    def __call__(self, principal: Principal) -> TestClient:
        self.principal = principal
        return self.client


@contextmanager
def migrated_database() -> Generator[str]:
    with fresh_database() as name:
        command.upgrade(alembic_config(with_database(OWNER_URL, name)), "head")
        yield name


@contextmanager
def api_as(database: str) -> Generator[ApiAs]:
    app = create_app(api_settings(database))
    with TestClient(app) as client:
        yield ApiAs(app, client)
