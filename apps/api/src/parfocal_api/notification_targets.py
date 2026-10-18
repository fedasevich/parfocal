import uuid

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.notification_catalogue import CATALOGUE, TargetKind
from parfocal_api.notifications import member_of
from parfocal_api.problems import ConflictError, NotFoundError
from parfocal_api.project_access import reads_slide, role_in
from parfocal_api.review_tasks import readable_task
from parfocal_api.tables import NotificationKind, jobs, notifications, projects, slides


class Target(BaseModel):
    kind: TargetKind
    project_id: uuid.UUID
    task_id: uuid.UUID | None = None
    slide_id: uuid.UUID | None = None
    object_id: str | None = None
    job_id: uuid.UUID | None = None


class NotificationNotFoundError(NotFoundError):
    code = "notification-not-found"
    title = "There is no such notification for you"


class TargetGoneError(NotFoundError):
    code = "target-gone"
    title = "What this notification points at is gone or no longer open to you"


class TargetNotAvailableError(ConflictError):
    code = "target-not-available"
    title = "This kind of target cannot be opened yet"


router = APIRouter(prefix="/api/me/notifications", tags=["me"])


async def project_of(connection: TenantConnection, project_id: uuid.UUID | None) -> uuid.UUID:
    if project_id is None or not await connection.scalar(
        select(projects.c.id).where(projects.c.id == project_id)
    ):
        raise TargetGoneError
    return project_id


@router.get("/{notification_id}/target", operation_id="getNotificationTarget")
async def get_notification_target(
    notification_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> Target:
    me = member_of(principal)
    row = (
        await connection.execute(
            select(notifications).where(
                notifications.c.id == notification_id, notifications.c.user_id == me.user_id
            )
        )
    ).one_or_none()
    if row is None:
        raise NotificationNotFoundError
    payload = dict(row.payload)
    match CATALOGUE[NotificationKind(row.kind)].target:
        case TargetKind.TASK | TargetKind.EVALUATION as kind:
            try:
                task, whole = await readable_task(connection, principal, row.target_id)
            except NotFoundError as error:
                raise TargetGoneError from error
            if kind is TargetKind.EVALUATION and not whole:
                raise TargetGoneError
            return Target(kind=kind, project_id=task.project_id, task_id=task.id)
        case TargetKind.SLIDE:
            project_id = await project_of(
                connection,
                await connection.scalar(
                    select(slides.c.project_id).where(slides.c.id == row.target_id)
                ),
            )
            if not await reads_slide(connection, principal, project_id, row.target_id):
                raise TargetGoneError
            task_id = payload.get("task_id")
            return Target(
                kind=TargetKind.SLIDE,
                project_id=project_id,
                slide_id=row.target_id,
                task_id=uuid.UUID(task_id) if task_id else None,
                object_id=payload.get("object_id"),
            )
        case TargetKind.JOB:
            project_id = await project_of(
                connection,
                await connection.scalar(
                    select(jobs.c.project_id).where(jobs.c.id == row.target_id)
                ),
            )
            if await role_in(connection, principal, project_id) is None:
                raise TargetGoneError
            return Target(kind=TargetKind.JOB, project_id=project_id, job_id=row.target_id)
        case TargetKind.PROJECT:
            project_id = await project_of(connection, row.target_id)
            if await role_in(connection, principal, project_id) is None:
                raise TargetGoneError
            return Target(kind=TargetKind.PROJECT, project_id=project_id)
        case TargetKind.THREAD | TargetKind.DELIVERY:
            raise TargetNotAvailableError
