import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from parfocal_api.app import create_app
from parfocal_api.settings import ApiSettings
from parfocal_common.clients import (
    ConsoleEmailSender,
    MissingProductionClientError,
    NoAnalytics,
    ProductionFactories,
)
from parfocal_common.envelope import InvalidMasterKeysError

REQUIRED = {
    "APP_ENV": "dev",
    "DATABASE_URL": "postgresql://parfocal@localhost:5432/parfocal",
    "PUBLIC_ORIGIN": "http://localhost:5173",
    "SESSION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "MASTER_KEYS": "dev:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
    "ZITADEL_ISSUER": "https://parfocal-iqcyh5.eu1.zitadel.cloud",
    "ZITADEL_CLIENT_ID": "client",
    "ZITADEL_CLIENT_SECRET": "zitadel-client-secret-value",
}


@pytest.fixture
def environment(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name, value in REQUIRED.items():
        monkeypatch.setenv(name, value)
    return monkeypatch


@pytest.mark.parametrize("missing", sorted(REQUIRED))
def test_startup_fails_on_a_missing_required_setting(
    environment: pytest.MonkeyPatch, missing: str
) -> None:
    environment.delenv(missing)
    with pytest.raises(ValidationError, match=missing.lower()):
        create_app()


def test_startup_reads_settings_and_serves_health(environment: pytest.MonkeyPatch) -> None:
    app = create_app()
    assert app.settings.database_url.hosts()[0]["host"] == "localhost"
    assert "zitadel-client-secret-value" not in repr(app.settings)
    assert isinstance(app.clients.email, ConsoleEmailSender)
    assert isinstance(app.clients.analytics, NoAnalytics)
    assert TestClient(app).get("/api/health").json() == {"status": "ok"}


CLOUD = {
    "DATABASE_URL": "postgresql+asyncpg://app@ep-x.eu-central-1.aws.neon.tech/db?ssl=require",
    "PUBLIC_ORIGIN": "https://app.parfocal.eu",
    "REALTIME_INTERNAL_URL": "https://app.parfocal.eu",
    "STORAGE_ENDPOINT": "https://account.r2.cloudflarestorage.com",
}


@pytest.fixture
def cloud(environment: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    environment.setenv("APP_ENV", "prod")
    for name, value in CLOUD.items():
        environment.setenv(name, value)
    return environment


def test_prod_refuses_to_start_without_production_clients(cloud: pytest.MonkeyPatch) -> None:
    cloud.setenv("STORAGE_SECRET_ACCESS_KEY", "storage-secret-from-the-store")
    with pytest.raises(MissingProductionClientError):
        create_app(production=ProductionFactories())


@pytest.mark.parametrize(
    ("name", "plain", "wanted"),
    [
        ("DATABASE_URL", "postgresql://app@ep-x.eu-central-1.aws.neon.tech/db", "ssl"),
        ("PUBLIC_ORIGIN", "http://app.parfocal.eu", "https"),
        ("REALTIME_INTERNAL_URL", "http://app.parfocal.eu", "https"),
        ("STORAGE_ENDPOINT", "http://account.r2.cloudflarestorage.com", "https"),
    ],
)
@pytest.mark.parametrize("app_env", ["staging", "prod"])
def test_cloud_environments_refuse_plain_transport(
    cloud: pytest.MonkeyPatch, app_env: str, name: str, plain: str, wanted: str
) -> None:
    cloud.setenv("APP_ENV", app_env)
    cloud.setenv("STORAGE_SECRET_ACCESS_KEY", "storage-secret-from-the-store")
    cloud.setenv(name, plain)
    with pytest.raises(ValidationError, match=f"{name} must use {wanted}"):
        create_app(production=ProductionFactories())


def test_prod_refuses_to_start_on_the_local_storage_secret(cloud: pytest.MonkeyPatch) -> None:
    environment = cloud
    with pytest.raises(ValidationError, match="STORAGE_SECRET_ACCESS_KEY is the local"):
        create_app(production=ProductionFactories())
    environment.setenv("APP_ENV", "dev")
    assert create_app().settings.storage().secret_access_key == "parfocal-local-secret"


def test_settings_can_be_passed_directly() -> None:
    settings = ApiSettings.model_validate({name.lower(): value for name, value in REQUIRED.items()})
    assert create_app(settings).settings is settings


def test_startup_refuses_a_malformed_master_keyring(environment: pytest.MonkeyPatch) -> None:
    environment.setenv("MASTER_KEYS", "dev:too-short")
    with pytest.raises(InvalidMasterKeysError):
        create_app()
