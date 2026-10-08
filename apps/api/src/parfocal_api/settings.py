from pydantic import HttpUrl, PostgresDsn, SecretStr

from parfocal_common.settings import ServiceSettings


class ApiSettings(ServiceSettings):
    database_url: PostgresDsn
    zitadel_issuer: HttpUrl
    zitadel_client_id: str
    zitadel_client_secret: SecretStr
