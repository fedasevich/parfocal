import pytest
from pydantic import AnyHttpUrl, SecretStr, ValidationError

from parfocal_common.settings import AppEnv, StorageSettings
from parfocal_common.transport import PlainTransportError, require_https, require_tls_database

SECRET = SecretStr("storage-secret-from-the-store")
R2 = AnyHttpUrl("https://account.r2.cloudflarestorage.com")


@pytest.mark.parametrize("app_env", [AppEnv.STAGING, AppEnv.PROD])
def test_cloud_storage_refuses_a_plain_http_endpoint(app_env: AppEnv) -> None:
    with pytest.raises(ValidationError, match="STORAGE_ENDPOINT must use https"):
        StorageSettings(app_env=app_env, storage_secret_access_key=SECRET)
    assert StorageSettings(
        app_env=app_env, storage_endpoint=R2, storage_secret_access_key=SECRET
    ).encrypted_transport()


@pytest.mark.parametrize("app_env", [AppEnv.DEV, AppEnv.TEST, AppEnv.PREVIEW])
def test_local_storage_may_use_plain_http(app_env: AppEnv) -> None:
    settings = StorageSettings(app_env=app_env)
    assert not settings.encrypted_transport()
    assert str(settings.storage_endpoint).startswith("http://")


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+asyncpg://app@ep-x.eu-central-1.aws.neon.tech/parfocal?ssl=require",
        "postgresql://app@ep-x.eu-central-1.aws.neon.tech/parfocal?sslmode=verify-full",
    ],
)
def test_a_database_url_with_tls_passes(url: str) -> None:
    require_tls_database("DATABASE_URL", url)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://app@ep-x.eu-central-1.aws.neon.tech/parfocal",
        "postgresql://app@ep-x.eu-central-1.aws.neon.tech/parfocal?ssl=prefer",
        "postgresql://app@ep-x.eu-central-1.aws.neon.tech/parfocal?sslmode=disable",
    ],
)
def test_a_database_url_without_required_tls_fails(url: str) -> None:
    with pytest.raises(PlainTransportError, match="DATABASE_URL must use ssl=require"):
        require_tls_database("DATABASE_URL", url)


def test_https_is_required_and_an_unset_url_is_skipped() -> None:
    require_https("PUBLIC_ORIGIN", "https://app.parfocal.eu")
    require_https("REALTIME_INTERNAL_URL", None)
    with pytest.raises(PlainTransportError, match="PUBLIC_ORIGIN must use https"):
        require_https("PUBLIC_ORIGIN", "http://app.parfocal.eu")
