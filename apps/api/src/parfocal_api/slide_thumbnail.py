import uuid

from fastapi import APIRouter, Response

from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError
from parfocal_api.slide_coverage import readable_slide
from parfocal_common.ingest import FIXTURES_PREFIX, folder_of, slide_prefix
from parfocal_common.object_store import StorageError

THUMBNAIL_FILE = "thumbnail.jpg"
THUMBNAIL_HEADERS = {"Cache-Control": "private, max-age=3600"}

router = APIRouter(prefix="/api/slides/{slide_id}/thumbnail", tags=["slides"])


class ThumbnailMissingError(NotFoundError):
    code = "thumbnail-missing"
    title = "This slide has no stored thumbnail yet"


@router.get(
    "",
    operation_id="getSlideThumbnail",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}}}},
    **require(Permission.SEE_SLIDES),
)
async def get_slide_thumbnail(
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
) -> Response:
    row = await readable_slide(connection, principal, slide_id)
    own = f"{slide_prefix(row.tenant_id, slide_id)}{THUMBNAIL_FILE}"
    keys = [own]
    if row.original_key is not None:
        beside_original = f"{folder_of(row.original_key)}{THUMBNAIL_FILE}"
        if beside_original != own and not row.original_key.startswith(FIXTURES_PREFIX):
            keys.append(beside_original)
    stored = None
    for key in keys:
        try:
            stored = await store.get_object(key)
            break
        except StorageError as error:
            if error.status != 404:
                raise
    if stored is None:
        raise ThumbnailMissingError
    return Response(stored, media_type="image/jpeg", headers=THUMBNAIL_HEADERS)
