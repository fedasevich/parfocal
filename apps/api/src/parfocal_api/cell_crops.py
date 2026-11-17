import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Response

from parfocal_api.blinding import require_ai_shown
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError
from parfocal_api.result_sets import slide_row
from parfocal_common.cell_crops import crop_key
from parfocal_common.object_store import StorageError

CROP_HEADERS = {"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"}

router = APIRouter(prefix="/api/slides/{slide_id}/cell-crops", tags=["slides"])


class CellCropMissingError(NotFoundError):
    code = "cell-crop-missing"
    title = "This cell has no stored crop"


@router.get(
    "/{number}",
    operation_id="getCellCrop",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}}}},
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_cell_crop(
    slide_id: uuid.UUID,
    number: Annotated[int, Path(ge=1, le=2**32 - 1)],
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
) -> Response:
    row = await slide_row(connection, principal, slide_id)
    await require_ai_shown(connection, principal, row.project_id, slide_id)
    try:
        stored = await store.get_object(crop_key(row.tenant_id, slide_id, number))
    except StorageError as error:
        if error.status != 404:
            raise
        raise CellCropMissingError from None
    return Response(stored, media_type="image/jpeg", headers=CROP_HEADERS)
