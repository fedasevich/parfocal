from pydantic import AnyHttpUrl, HttpUrl, PostgresDsn, SecretStr

from parfocal_common.settings import ServiceSettings


class ApiSettings(ServiceSettings):
    database_url: PostgresDsn
    public_origin: AnyHttpUrl
    session_key: SecretStr
    master_keys: SecretStr
    zitadel_issuer: HttpUrl
    zitadel_client_id: str
    zitadel_client_secret: SecretStr
