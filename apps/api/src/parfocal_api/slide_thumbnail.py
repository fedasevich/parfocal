import uuid

from fastapi import APIRouter, Response

from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError
from parfocal_api.slide_coverage import readable_slide
from parfocal_common.ingest import slide_prefix
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
    try:
        stored = await store.get_object(f"{slide_prefix(row.tenant_id, slide_id)}{THUMBNAIL_FILE}")
    except StorageError as error:
        if error.status == 404:
            raise ThumbnailMissingError from error
        raise
    return Response(stored, media_type="image/jpeg", headers=THUMBNAIL_HEADERS)
