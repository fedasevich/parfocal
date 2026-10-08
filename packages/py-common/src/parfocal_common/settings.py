from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class AppEnv(StrEnum):
    DEV = "dev"
    TEST = "test"
    PREVIEW = "preview"
    STAGING = "staging"
    PROD = "prod"


type EmailBackend = Literal["console", "memory", "resend"]
type ErrorBackend = Literal["console", "sentry"]
type TelemetryExport = Literal["console", "otlp"]
type AnalyticsBackend = Literal["none", "posthog"]
type FlagBackend = Literal["file", "posthog"]


@dataclass(frozen=True)
class Backends:
    email: EmailBackend
    errors: ErrorBackend
    telemetry: TelemetryExport
    analytics: AnalyticsBackend
    flags: FlagBackend


PRODUCTION_BACKENDS = Backends(
    email="resend", errors="sentry", telemetry="otlp", analytics="posthog", flags="posthog"
)
LOCAL_BACKENDS = Backends(
    email="console", errors="console", telemetry="console", analytics="none", flags="file"
)


def default_backends(app_env: AppEnv) -> Backends:
    if app_env is AppEnv.PROD:
        return PRODUCTION_BACKENDS
    if app_env is AppEnv.TEST:
        return Backends(
            email="memory",
            errors=LOCAL_BACKENDS.errors,
            telemetry=LOCAL_BACKENDS.telemetry,
            analytics=LOCAL_BACKENDS.analytics,
            flags=LOCAL_BACKENDS.flags,
        )
    return LOCAL_BACKENDS


class ServiceSettings(BaseSettings):
    model_config = SettingsConfigDict(frozen=True, extra="ignore")

    app_env: AppEnv
    email_backend: EmailBackend | None = None
    error_backend: ErrorBackend | None = None
    telemetry_export: TelemetryExport | None = None
    analytics_backend: AnalyticsBackend | None = None
    flag_backend: FlagBackend | None = None
    flag_file: str = "flags.json"

    def backends(self) -> Backends:
        defaults = default_backends(self.app_env)
        return Backends(
            email=self.email_backend or defaults.email,
            errors=self.error_backend or defaults.errors,
            telemetry=self.telemetry_export or defaults.telemetry,
            analytics=self.analytics_backend or defaults.analytics,
            flags=self.flag_backend or defaults.flags,
        )


def load_settings[T: ServiceSettings](settings_class: type[T]) -> T:
    from_environment: dict[str, Any] = {}
    return settings_class(**from_environment)
