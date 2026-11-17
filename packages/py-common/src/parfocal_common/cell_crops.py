import uuid

from parfocal_common.ingest import slide_prefix

CROP_MICRONS = 24.0
CROP_SIDE = 64
CROP_FOLDER = "cell-crops/"


def crop_folder(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> str:
    return f"{slide_prefix(tenant_id, slide_id)}{CROP_FOLDER}"


def crop_key(tenant_id: uuid.UUID, slide_id: uuid.UUID, number: int) -> str:
    return f"{crop_folder(tenant_id, slide_id)}{number}.jpg"
