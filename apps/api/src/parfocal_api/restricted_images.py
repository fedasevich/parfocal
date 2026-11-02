import uuid
from collections.abc import Sequence
from typing import Any

from fastapi import APIRouter, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Grant, Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import ForbiddenError, NotFoundError
from parfocal_api.project_access import project_grant, reads_whole, require_slide_reading
from parfocal_api.tables import PrivacyMode, projects, slides
from parfocal_common.ingest import (
    RESTRICTED_FILES,
    RestrictedImage,
    restricted_key,
    restricted_prefix,
    slide_prefixes,
)
from parfocal_common.object_store import ObjectStore, StorageError

PRIVATE_HEADERS = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
IMAGE_RESPONSE: dict[int | str, dict[str, Any]] = {
    200: {
        "description": "The image, never cached",
        "content": {
            media_type: {"schema": {"type": "string", "format": "binary"}}
            for _, media_type in RESTRICTED_FILES.values()
        },
    }
}


class RestrictedImageNotFoundError(NotFoundError):
    code = "restricted-image-not-found"
    title = "This slide has no such image to show"


class RestrictedImagesForReadersError(ForbiddenError):
    code = "restricted-images-for-readers"
    title = "Only the project's owners, viewers and this slide's reviewers see labels and macros"


router = APIRouter(prefix="/api/slides/{slide_id}/restricted-images", tags=["slides"])


async def sees_restricted(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    privacy_mode: PrivacyMode,
) -> bool:
    if privacy_mode is not PrivacyMode.CLINICAL:
        return False
    grant = await project_grant(connection, principal, project_id, Permission.SEE_LABELS)
    return reads_whole(grant) or grant is Grant.ASSIGNED


def shown(stored: Sequence[str], visible: bool) -> list[RestrictedImage]:
    return [RestrictedImage(kind) for kind in stored] if visible else []


@router.get(
    "/{image}",
    operation_id="getRestrictedImage",
    response_class=Response,
    responses=IMAGE_RESPONSE,
    **require(Permission.SEE_LABELS),
)
async def get_restricted_image(
    slide_id: uuid.UUID,
    image: RestrictedImage,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
) -> Response:
    row = (
        await connection.execute(
            select(
                slides.c.tenant_id,
                slides.c.project_id,
                slides.c.restricted_images,
                projects.c.privacy_mode,
            )
            .join(projects, projects.c.id == slides.c.project_id)
            .where(slides.c.id == slide_id, slides.c.deleted_at.is_(None))
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Slide not found")
    mode = PrivacyMode(row.privacy_mode)
    await require_slide_reading(
        connection, principal, row.project_id, mode, slide_id, "Slide not found"
    )
    if mode is not PrivacyMode.CLINICAL:
        raise RestrictedImageNotFoundError
    if not await sees_restricted(connection, principal, row.project_id, mode):
        raise RestrictedImagesForReadersError
    if image.value not in row.restricted_images:
        raise RestrictedImageNotFoundError
    try:
        body = await store.get_object(restricted_key(row.tenant_id, slide_id, image))
    except StorageError as error:
        if error.status == 404:
            raise RestrictedImageNotFoundError from error
        raise
    await record(
        connection,
        actor_of(principal),
        AuditAction.SLIDE_RESTRICTED_IMAGE_VIEWED,
        AuditTarget.SLIDE,
        slide_id,
        tenant_id=row.tenant_id,
        details={"image": image.value},
    )
    return Response(body, media_type=RESTRICTED_FILES[image][1], headers=PRIVATE_HEADERS)


async def delete_under(store: ObjectStore, prefix: str) -> int:
    keys = await store.list_keys(prefix)
    for key in keys:
        await store.delete_object(key)
    return len(keys)


async def delete_restricted_images(
    store: ObjectStore, tenant_id: uuid.UUID, slide_id: uuid.UUID
) -> int:
    return await delete_under(store, restricted_prefix(tenant_id, slide_id))


async def delete_slide_files(store: ObjectStore, tenant_id: uuid.UUID, slide_id: uuid.UUID) -> int:
    deleted = 0
    for prefix in slide_prefixes(tenant_id, slide_id):
        deleted += await delete_under(store, prefix)
    return deleted
