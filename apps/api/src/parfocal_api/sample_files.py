from pydantic import BaseModel, ValidationError

from parfocal_common.ingest import SAMPLE_FACTS_NAME, sample_folder
from parfocal_common.object_store import ObjectStore, StorageError


class SampleFile(BaseModel):
    original_key: str
    file_bytes: int
    sha256: str
    format: str
    variant: str | None
    reader: str
    width: int
    height: int
    level_count: int
    mpp_x: float | None
    mpp_y: float | None
    objective_power: float | None
    notices: list[str]


def facts_key(label: str) -> str:
    return f"{sample_folder(label)}{SAMPLE_FACTS_NAME}"


async def stored_sample_file(store: ObjectStore, label: str) -> SampleFile | None:
    try:
        body = await store.get_object(facts_key(label))
    except StorageError as error:
        if error.status == 404:
            return None
        raise
    try:
        found = SampleFile.model_validate_json(body)
    except ValidationError:
        return None
    if not found.original_key.startswith(sample_folder(label)):
        return None
    return found
