import tempfile
from pathlib import Path
from typing import Annotated

from pydantic import Field, SecretStr

from parfocal_common.part_plan import MIB, MIN_PART_BYTES
from parfocal_common.settings import StorageSettings

GIB = 1024 * MIB
DEFAULT_COPY_PART_BYTES = GIB
MAX_COPY_PART_BYTES = 4 * GIB
INGEST_MEMORY_MIB = 2048
INGEST_MEMORY_LIMIT_MIB = 4096
PARSE_MEMORY_MIB = 3072
PARSE_SECONDS = 1800.0


def default_work_dir() -> str:
    return str(Path(tempfile.gettempdir()) / "parfocal-ingest")


class IngestSettings(StorageSettings):
    ingest_work_dir: str = Field(default_factory=default_work_dir)
    ingest_copy_part_bytes: Annotated[int, Field(ge=MIN_PART_BYTES, le=MAX_COPY_PART_BYTES)] = (
        DEFAULT_COPY_PART_BYTES
    )
    ingest_parse_memory_mib: Annotated[int, Field(ge=64, le=INGEST_MEMORY_LIMIT_MIB)] = (
        PARSE_MEMORY_MIB
    )
    ingest_parse_seconds: Annotated[float, Field(gt=0)] = PARSE_SECONDS
    ingest_parse_user: str | None = None
    ingest_parse_launcher: str | None = None
    master_keys: SecretStr | None = None
