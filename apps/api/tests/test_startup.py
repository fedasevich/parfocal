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

REQUIRED = {
    "APP_ENV": "dev",
    "DATABASE_URL": "postgresql://parfocal@localhost:5432/parfocal",
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


def test_prod_refuses_to_start_without_production_clients(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv("APP_ENV", "prod")
    with pytest.raises(MissingProductionClientError):
        create_app(production=ProductionFactories())


def test_settings_can_be_passed_directly() -> None:
    settings = ApiSettings.model_validate({name.lower(): value for name, value in REQUIRED.items()})
    assert create_app(settings).settings is settings
