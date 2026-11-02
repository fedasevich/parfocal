import tempfile
from pathlib import Path
from typing import Annotated

from pydantic import Field

from parfocal_common.part_plan import MIB, MIN_PART_BYTES
from parfocal_common.settings import StorageSettings

GIB = 1024 * MIB
DEFAULT_COPY_PART_BYTES = GIB
MAX_COPY_PART_BYTES = 4 * GIB
INGEST_MEMORY_MIB = 2048
INGEST_MEMORY_LIMIT_MIB = 4096


def default_work_dir() -> str:
    return str(Path(tempfile.gettempdir()) / "parfocal-ingest")


class IngestSettings(StorageSettings):
    ingest_work_dir: str = Field(default_factory=default_work_dir)
    ingest_copy_part_bytes: Annotated[int, Field(ge=MIN_PART_BYTES, le=MAX_COPY_PART_BYTES)] = (
        DEFAULT_COPY_PART_BYTES
    )
