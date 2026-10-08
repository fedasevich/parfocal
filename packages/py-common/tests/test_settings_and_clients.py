from pathlib import Path

import pytest
from pydantic import ValidationError

from parfocal_common.clients import (
    ConsoleEmailSender,
    ConsoleErrorReporter,
    ConsoleTelemetryExporter,
    Factory,
    FileFlagClient,
    MemoryEmailSender,
    MissingProductionClientError,
    NoAnalytics,
    ProductionFactories,
    select_clients,
)
from parfocal_common.settings import AppEnv, ServiceSettings, load_settings

NON_PRODUCTION = [env for env in AppEnv if env is not AppEnv.PROD]


def recording_factories(calls: list[str]) -> ProductionFactories:
    def record[T](concern: str, client: T) -> Factory[T]:
        def build(_: ServiceSettings) -> T:
            calls.append(concern)
            return client

        return build

    return ProductionFactories(
        email=record("email", MemoryEmailSender()),
        errors=record("errors", ConsoleErrorReporter()),
        telemetry=record("telemetry", ConsoleTelemetryExporter()),
        analytics=record("analytics", NoAnalytics()),
        flags=record("flags", FileFlagClient({})),
    )


def settings(**values: str) -> ServiceSettings:
    return ServiceSettings.model_validate(values)


def test_app_env_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    with pytest.raises(ValidationError, match="app_env"):
        load_settings(ServiceSettings)


def test_app_env_is_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "staging")
    assert load_settings(ServiceSettings).app_env is AppEnv.STAGING


def test_unknown_app_env_is_rejected() -> None:
    with pytest.raises(ValidationError):
        settings(app_env="production")


@pytest.mark.parametrize("app_env", NON_PRODUCTION)
def test_no_production_client_outside_prod(app_env: AppEnv) -> None:
    calls: list[str] = []
    clients = select_clients(settings(app_env=app_env), recording_factories(calls))
    assert calls == []
    assert isinstance(clients.analytics, NoAnalytics)
    assert isinstance(clients.flags, FileFlagClient)


def test_prod_creates_every_production_client() -> None:
    calls: list[str] = []
    select_clients(settings(app_env="prod"), recording_factories(calls))
    assert sorted(calls) == ["analytics", "email", "errors", "flags", "telemetry"]


def test_tests_get_an_in_memory_email_sender() -> None:
    clients = select_clients(settings(app_env="test"), ProductionFactories())
    assert isinstance(clients.email, MemoryEmailSender)
    assert isinstance(
        select_clients(settings(app_env="dev"), ProductionFactories()).email, ConsoleEmailSender
    )


def test_an_override_switches_one_concern_only() -> None:
    calls: list[str] = []
    select_clients(settings(app_env="staging", email_backend="resend"), recording_factories(calls))
    assert calls == ["email"]


def test_prod_without_a_configured_client_fails_at_startup() -> None:
    with pytest.raises(MissingProductionClientError, match="email backend 'resend'"):
        select_clients(settings(app_env="prod"), ProductionFactories())


def test_local_flags_come_from_the_flag_file(tmp_path: Path) -> None:
    flag_file = tmp_path / "flags.json"
    flag_file.write_text('{"home-variant": "B"}')
    clients = select_clients(
        settings(app_env="dev", flag_file=str(flag_file)), ProductionFactories()
    )
    assert clients.flags.variant("home-variant", "user-1") == "B"
    assert clients.flags.variant("unknown", "user-1") is None
