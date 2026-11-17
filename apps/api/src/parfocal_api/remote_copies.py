import uuid

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Grant, Permission, require
from parfocal_api.problems import ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import project_grant
from parfocal_api.tables import SlideStorage, slides
from parfocal_common.remote_inspect import enqueue_remote_copy

router = APIRouter(prefix="/api/slides", tags=["slides"])


class SlideNotRemoteError(ConflictError):
    code = "slide-not-remote"
    title = "This slide is already stored in Parfocal"


class RemoteSlideNotReadyError(ConflictError):
    code = "remote-slide-not-ready"
    title = "This slide is still being inspected at its source"


class CopyAsked(BaseModel):
    job_id: uuid.UUID


@router.post(
    "/{slide_id}/copy-in",
    operation_id="copyRemoteSlide",
    status_code=202,
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def copy_remote_slide(
    slide_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> CopyAsked:
    row = (
        await connection.execute(
            select(
                slides.c.tenant_id, slides.c.project_id, slides.c.storage, slides.c.published_at
            ).where(slides.c.id == slide_id, slides.c.deleted_at.is_(None))
        )
    ).first()
    if row is None:
        raise NotFoundError("Slide not found")
    grant = await project_grant(connection, principal, row.project_id, Permission.UPLOAD_SLIDES)
    if grant is not Grant.ALL:
        seen = await project_grant(connection, principal, row.project_id, Permission.SEE_SLIDES)
        if seen is Grant.NONE:
            raise NotFoundError("Slide not found")
        raise ForbiddenError
    if row.storage != SlideStorage.REMOTE:
        raise SlideNotRemoteError
    if row.published_at is None:
        raise RemoteSlideNotReadyError
    job_id = await enqueue_remote_copy(connection, row.tenant_id, row.project_id, slide_id)
    await record(
        connection,
        actor_of(principal),
        AuditAction.SLIDE_COPY_ASKED,
        AuditTarget.SLIDE,
        slide_id,
        tenant_id=row.tenant_id,
        details={"project_id": str(row.project_id), "job_id": str(job_id)},
    )
    return CopyAsked(job_id=job_id)
