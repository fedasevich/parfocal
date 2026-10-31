from typing import Annotated

from pydantic import AfterValidator, AnyHttpUrl, Field, HttpUrl, PositiveInt, PostgresDsn, SecretStr

from parfocal_common.object_store import LIST_PAGE_LIMIT, MAX_PRESIGN_SECONDS
from parfocal_common.part_plan import (
    DEFAULT_PART_BYTES,
    MAX_PART_BYTES,
    MAX_PARTS,
    MIB,
    MIN_PART_BYTES,
)
from parfocal_common.settings import StorageSettings

GIB = 1024 * MIB
DEFAULT_UPLOAD_MAX_BYTES = 20 * GIB


def whole_mib(value: int) -> int:
    if value % MIB:
        raise ValueError("A part size is a whole MiB")
    return value


class ApiSettings(StorageSettings):
    database_url: PostgresDsn
    public_origin: AnyHttpUrl
    session_key: SecretStr
    master_keys: SecretStr
    zitadel_issuer: HttpUrl
    zitadel_client_id: str
    zitadel_client_secret: SecretStr
    rate_limit_person_per_minute: PositiveInt = 600
    rate_limit_tenant_per_minute: PositiveInt = 3000
    result_store_dir: str = ".results"
    upload_max_bytes: Annotated[int, Field(ge=1, le=MAX_PARTS * MAX_PART_BYTES)] = (
        DEFAULT_UPLOAD_MAX_BYTES
    )
    upload_part_bytes: Annotated[
        int, Field(ge=MIN_PART_BYTES, le=MAX_PART_BYTES), AfterValidator(whole_mib)
    ] = DEFAULT_PART_BYTES
    upload_part_url_seconds: Annotated[int, Field(ge=1, le=MAX_PRESIGN_SECONDS)] = 15 * 60
    upload_list_page_size: Annotated[int, Field(ge=1, le=LIST_PAGE_LIMIT)] = LIST_PAGE_LIMIT
