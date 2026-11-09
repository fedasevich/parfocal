import uuid
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from parfocal_api.blinding import sees_reviewer
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.notification_catalogue import TargetKind, target_kind_of
from parfocal_api.notifications import member_of, uuid_or_none
from parfocal_api.origins import Origin, OriginRoute
from parfocal_api.problems import ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import reads_slide, role_in
from parfocal_api.review_tasks import readable_task
from parfocal_api.reviewed_layer import review_slide
from parfocal_api.search import SearchContext, current_ids
from parfocal_api.tables import jobs, notifications, projects, slides
from parfocal_api.threads import visible_thread
from parfocal_common.object_ids import ObjectIdError, parse


class Target(BaseModel):
    kind: TargetKind
    project_id: uuid.UUID
    task_id: uuid.UUID | None = None
    slide_id: uuid.UUID | None = None
    object_id: str | None = None
    job_id: uuid.UUID | None = None
    thread_id: uuid.UUID | None = None
    case_id: uuid.UUID | None = None
    resolved_from: str | None = None
    origin: Origin


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
        select(projects.c.id).where(projects.c.id == project_id, projects.c.deleted_at.is_(None))
    ):
        raise TargetGoneError
    return project_id


def origin_of(
    project_id: uuid.UUID,
    task_id: uuid.UUID | None = None,
    case_id: uuid.UUID | None = None,
) -> Origin:
    if task_id is not None:
        return Origin(route=OriginRoute.TASK, project_id=project_id, task_id=task_id)
    if case_id is not None:
        return Origin(route=OriginRoute.CASE, project_id=project_id, case_id=case_id)
    return Origin(route=OriginRoute.PROJECT, project_id=project_id)


async def current_object(
    connection: TenantConnection,
    principal: CurrentPrincipal,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    task_id: uuid.UUID | None,
    object_id: str | None,
) -> tuple[str | None, str | None]:
    if object_id is None:
        return None, None
    try:
        found = parse(object_id)
    except ObjectIdError:
        return object_id, None
    context = SearchContext(project_id=project_id, slide_id=slide_id, task_id=task_id)
    _, resolved = await current_ids(connection, principal, slide_id, found, context)
    if len(resolved) != 1 or resolved[0] == found:
        return object_id, None
    return resolved[0].text(ascii=True), object_id


async def decision_target(
    connection: TenantConnection, principal: CurrentPrincipal, row: Any, payload: dict[str, Any]
) -> Target:
    task_id = uuid_or_none(payload.get("task_id"))
    author = uuid_or_none(payload.get("actor_user_id"))
    if task_id is None or author is None:
        raise TargetGoneError
    try:
        place = await review_slide(connection, principal, task_id, row.target_id)
    except NotFoundError, ForbiddenError:
        raise TargetGoneError from None
    if not await sees_reviewer(
        connection, principal, place.project_id, task_id, row.target_id, author
    ):
        raise TargetGoneError
    object_id, resolved_from = await current_object(
        connection, principal, place.project_id, row.target_id, task_id, payload.get("object_id")
    )
    case_id = await connection.scalar(select(slides.c.case_id).where(slides.c.id == row.target_id))
    return Target(
        kind=TargetKind.DECISION,
        project_id=place.project_id,
        task_id=task_id,
        slide_id=row.target_id,
        object_id=object_id,
        resolved_from=resolved_from,
        case_id=case_id,
        origin=origin_of(place.project_id, task_id=task_id, case_id=case_id),
    )


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
    match target_kind_of(row):
        case TargetKind.TASK | TargetKind.EVALUATION as kind:
            try:
                task, whole = await readable_task(connection, principal, row.target_id)
            except NotFoundError as error:
                raise TargetGoneError from error
            shown = kind if whole else TargetKind.TASK
            back = (
                Origin(route=OriginRoute.PROJECT, project_id=task.project_id)
                if whole
                else Origin(route=OriginRoute.MY_WORK)
            )
            return Target(kind=shown, project_id=task.project_id, task_id=task.id, origin=back)
        case TargetKind.SLIDE:
            slide = (
                await connection.execute(
                    select(slides.c.project_id, slides.c.case_id).where(
                        slides.c.id == row.target_id, slides.c.deleted_at.is_(None)
                    )
                )
            ).one_or_none()
            project_id = await project_of(connection, slide.project_id if slide else None)
            if not await reads_slide(connection, principal, project_id, row.target_id):
                raise TargetGoneError
            given = payload.get("task_id")
            task_id = uuid.UUID(given) if given else None
            object_id, resolved_from = await current_object(
                connection, principal, project_id, row.target_id, task_id, payload.get("object_id")
            )
            return Target(
                kind=TargetKind.SLIDE,
                project_id=project_id,
                slide_id=row.target_id,
                case_id=slide.case_id if slide else None,
                task_id=task_id,
                object_id=object_id,
                resolved_from=resolved_from,
                origin=origin_of(
                    project_id, task_id=task_id, case_id=slide.case_id if slide else None
                ),
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
            return Target(
                kind=TargetKind.JOB,
                project_id=project_id,
                job_id=row.target_id,
                origin=origin_of(project_id),
            )
        case TargetKind.PROJECT:
            project_id = await project_of(connection, row.target_id)
            if await role_in(connection, principal, project_id) is None:
                raise TargetGoneError
            return Target(
                kind=TargetKind.PROJECT,
                project_id=project_id,
                origin=Origin(route=OriginRoute.HOME),
            )
        case TargetKind.THREAD:
            thread = await visible_thread(connection, principal, row.target_id)
            if thread is None:
                raise TargetGoneError
            object_id, resolved_from = (
                await current_object(
                    connection,
                    principal,
                    thread.project_id,
                    thread.slide_id,
                    thread.task_id,
                    thread.object_id,
                )
                if thread.slide_id is not None
                else (thread.object_id, None)
            )
            case_id = await connection.scalar(
                select(slides.c.case_id).where(slides.c.id == thread.slide_id)
            )
            return Target(
                kind=TargetKind.THREAD,
                project_id=thread.project_id,
                task_id=thread.task_id,
                slide_id=thread.slide_id,
                object_id=object_id,
                resolved_from=resolved_from,
                thread_id=thread.id,
                case_id=case_id,
                origin=origin_of(thread.project_id, task_id=thread.task_id, case_id=case_id),
            )
        case TargetKind.DECISION:
            return await decision_target(connection, principal, row, payload)
        case TargetKind.DELIVERY | TargetKind.ACCESS_REQUEST | TargetKind.TEMPLATE_OFFER:
            raise TargetNotAvailableError
