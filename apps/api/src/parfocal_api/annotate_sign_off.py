import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blind_first import announce_visibility, seen_by
from parfocal_api.check_options import requires_all_checked
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError
from parfocal_api.project_access import role_in
from parfocal_api.projects import ProjectArchivedError
from parfocal_api.realtime import RealtimeClient
from parfocal_api.review_order import CheckState, check_counts, unchecked_objects
from parfocal_api.reviewed_layer import task_slide
from parfocal_api.tables import (
    ProjectRole,
    annotations,
    evaluation_changes,
    evaluation_versions,
    review_assignments,
    review_task_slides,
    review_tasks,
    threads,
)
from parfocal_api.task_kinds import annotate_only


class LayerChange(StrEnum):
    ADDED = "added"
    EDITED = "edited"
    DELETED = "deleted"


class CheckDraft(BaseModel):
    nothing_to_mark: bool = False


class ExpertCheck(BaseModel):
    user_id: uuid.UUID
    checked_at: datetime | None
    nothing_to_mark: bool


class CheckProgress(BaseModel):
    scope: int
    checked: int
    unchecked: int
    confirmed: int
    edited: int
    deleted: int


def progress_of(counts: dict[CheckState, int] | None) -> CheckProgress | None:
    if counts is None:
        return None
    unchecked = counts[CheckState.UNCHECKED]
    total = sum(counts.values())
    return CheckProgress(
        scope=total,
        checked=total - unchecked,
        unchecked=unchecked,
        confirmed=counts[CheckState.CONFIRMED],
        edited=counts[CheckState.EDITED],
        deleted=counts[CheckState.DELETED],
    )


class AnnotateSlideStatus(BaseModel):
    task_id: uuid.UUID
    slide_id: uuid.UUID
    experts: list[ExpertCheck]
    signed_off_at: datetime | None
    signed_off_by_user_id: uuid.UUID | None
    open_threads: int
    unchecked_objects: int
    all_checked_required: bool
    check_progress: CheckProgress | None


class NotAssignedExpertError(ForbiddenError):
    code = "not-assigned"
    title = "Only an expert assigned to this slide does that"


class OwnersOnlyError(ForbiddenError):
    code = "project-owners-only"
    title = "Only an owner of this project does that"


class SlideSignedOffError(ConflictError):
    code = "slide-signed-off"
    title = "This slide is signed off. Only a project owner changes it, with a reason"


class SlideAlreadySignedOffError(ConflictError):
    code = "slide-already-signed-off"
    title = "This slide is already signed off"


class AlreadyCheckedError(ConflictError):
    code = "already-checked"
    title = "You already checked this slide"


class NotCheckedError(ConflictError):
    code = "not-checked"
    title = "You have not checked this slide"


class LayerNotEmptyError(ConflictError):
    code = "layer-not-empty"
    title = "The shared layer has objects on this slide, so mark it checked instead"


class ExpertsUncheckedError(ConflictError):
    code = "experts-unchecked"
    title = "Some assigned experts have not checked this slide"


class ObjectsUncheckedError(ConflictError):
    code = "objects-unchecked"
    title = "Some AI objects in the check scope are not checked yet"


class ReasonNeededError(BadRequestError):
    code = "reason-needed"
    title = "Give a reason for a change to a signed-off slide"


router = APIRouter(prefix="/api/review-tasks/{task_id}/slides/{slide_id}", tags=["review-tasks"])


def user_of(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


async def annotate_slide(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID, slide_id: uuid.UUID
) -> Any:
    row = await task_slide(connection, principal, task_id, slide_id)
    annotate_only(row.kind)
    return row


async def is_owner(connection: AsyncConnection, principal: Principal, row: Any) -> bool:
    return await role_in(connection, principal, row.project_id) is ProjectRole.OWNER


def writable(row: Any) -> None:
    if row.archived_at is not None:
        raise ProjectArchivedError


async def experts_of(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID
) -> list[ExpertCheck]:
    rows = await connection.execute(
        select(
            review_assignments.c.user_id,
            review_assignments.c.submitted_at,
            review_assignments.c.nothing_to_mark,
        )
        .where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.slide_id == slide_id,
            review_assignments.c.released_at.is_(None),
        )
        .order_by(review_assignments.c.assigned_at, review_assignments.c.user_id)
    )
    return [
        ExpertCheck(
            user_id=row.user_id, checked_at=row.submitted_at, nothing_to_mark=row.nothing_to_mark
        )
        for row in rows
    ]


async def check_options_of(connection: AsyncConnection, task_id: uuid.UUID) -> Any:
    return await connection.scalar(
        select(review_tasks.c.check_options).where(review_tasks.c.id == task_id)
    )


async def status_of(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID
) -> AnnotateSlideStatus:
    signed = (
        await connection.execute(
            select(
                review_task_slides.c.signed_off_at, review_task_slides.c.signed_off_by_user_id
            ).where(
                review_task_slides.c.task_id == task_id, review_task_slides.c.slide_id == slide_id
            )
        )
    ).one()
    open_threads = await connection.scalar(
        select(func.count()).where(
            threads.c.task_id == task_id,
            threads.c.slide_id == slide_id,
            threads.c.resolved_at.is_(None),
        )
    )
    required = requires_all_checked(await check_options_of(connection, task_id))
    return AnnotateSlideStatus(
        task_id=task_id,
        slide_id=slide_id,
        experts=await experts_of(connection, task_id, slide_id),
        signed_off_at=signed.signed_off_at,
        signed_off_by_user_id=signed.signed_off_by_user_id,
        open_threads=open_threads or 0,
        unchecked_objects=(
            await unchecked_objects(connection, task_id, slide_id)
            if required and signed.signed_off_at is None
            else 0
        ),
        all_checked_required=required,
        check_progress=progress_of(await check_counts(connection, task_id, slide_id)),
    )


async def my_check(connection: AsyncConnection, principal: Principal, row: Any) -> Any:
    found = (
        await connection.execute(
            select(review_assignments.c.submitted_at).where(
                review_assignments.c.task_id == row.task_id,
                review_assignments.c.slide_id == row.slide_id,
                review_assignments.c.user_id == user_of(principal),
                review_assignments.c.released_at.is_(None),
            )
        )
    ).one_or_none()
    if found is None:
        raise NotAssignedExpertError
    if row.slide_signed_off_at is not None:
        raise SlideSignedOffError
    writable(row)
    return found


async def layer_has_objects(connection: AsyncConnection, principal: Principal, row: Any) -> bool:
    live = select(annotations.c.id).where(
        annotations.c.task_id == row.task_id,
        annotations.c.slide_id == row.slide_id,
        annotations.c.deleted_at.is_(None),
        *seen_by(row.blind_first, principal),
    )
    return bool(await connection.scalar(select(live.exists())))


async def mark(
    connection: AsyncConnection,
    principal: Principal,
    row: Any,
    checked: bool,
    nothing_to_mark: bool = False,
) -> None:
    await connection.execute(
        update(review_assignments)
        .where(
            review_assignments.c.task_id == row.task_id,
            review_assignments.c.slide_id == row.slide_id,
            review_assignments.c.user_id == user_of(principal),
        )
        .values(
            submitted_at=func.now() if checked else None,
            nothing_to_mark=nothing_to_mark,
        )
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.TASK_SLIDE_CHECKED if checked else AuditAction.TASK_SLIDE_UNCHECKED,
        AuditTarget.REVIEW_TASK,
        row.task_id,
        tenant_id=row.tenant_id,
        details={"slide_id": str(row.slide_id), "nothing_to_mark": nothing_to_mark},
    )


@router.get(
    "/check-status",
    operation_id="getAnnotateSlideStatus",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_annotate_slide_status(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> AnnotateSlideStatus:
    await annotate_slide(connection, principal, task_id, slide_id)
    return await status_of(connection, task_id, slide_id)


@router.post("/check", operation_id="checkAnnotateSlide", **require(Permission.REVIEW, write=True))
async def check_annotate_slide(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    background: BackgroundTasks,
    live: RealtimeClient,
    draft: CheckDraft | None = None,
) -> AnnotateSlideStatus:
    row = await annotate_slide(connection, principal, task_id, slide_id)
    current = await my_check(connection, principal, row)
    if current.submitted_at is not None:
        raise AlreadyCheckedError
    nothing_to_mark = (draft or CheckDraft()).nothing_to_mark
    if nothing_to_mark and await layer_has_objects(connection, principal, row):
        raise LayerNotEmptyError
    await mark(connection, principal, row, True, nothing_to_mark)
    announce_visibility(background, live, row, user_of(principal))
    return await status_of(connection, task_id, slide_id)


@router.post(
    "/uncheck", operation_id="uncheckAnnotateSlide", **require(Permission.REVIEW, write=True)
)
async def uncheck_annotate_slide(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    background: BackgroundTasks,
    live: RealtimeClient,
) -> AnnotateSlideStatus:
    row = await annotate_slide(connection, principal, task_id, slide_id)
    current = await my_check(connection, principal, row)
    if current.submitted_at is None:
        raise NotCheckedError
    await mark(connection, principal, row, False)
    announce_visibility(background, live, row, user_of(principal))
    return await status_of(connection, task_id, slide_id)


@router.post(
    "/sign-off",
    operation_id="signOffAnnotateSlide",
    **require(Permission.CREATE_CASES, write=True),
)
async def sign_off_annotate_slide(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> AnnotateSlideStatus:
    row = await annotate_slide(connection, principal, task_id, slide_id)
    if not await is_owner(connection, principal, row):
        raise OwnersOnlyError
    if row.slide_signed_off_at is not None:
        raise SlideAlreadySignedOffError
    before = await status_of(connection, task_id, slide_id)
    if not before.experts or any(expert.checked_at is None for expert in before.experts):
        raise ExpertsUncheckedError
    if before.all_checked_required and before.unchecked_objects:
        raise ObjectsUncheckedError
    writable(row)
    await connection.execute(
        update(review_task_slides)
        .where(review_task_slides.c.task_id == task_id, review_task_slides.c.slide_id == slide_id)
        .values(signed_off_at=func.now(), signed_off_by_user_id=user_of(principal))
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.TASK_SLIDE_SIGNED_OFF,
        AuditTarget.REVIEW_TASK,
        task_id,
        tenant_id=row.tenant_id,
        details={"slide_id": str(slide_id), "open_threads": before.open_threads},
    )
    return await status_of(connection, task_id, slide_id)


async def owner_change_allowed(
    connection: AsyncConnection, principal: Principal, row: Any, reason: str | None
) -> bool:
    if row.slide_signed_off_at is None:
        return False
    if not await is_owner(connection, principal, row):
        raise SlideSignedOffError
    if reason is None or not reason.strip():
        raise ReasonNeededError
    writable(row)
    return True


async def log_layer_change(
    connection: AsyncConnection,
    principal: Principal,
    row: Any,
    object_code: str,
    change: LayerChange,
    reason: str,
) -> None:
    version = await connection.scalar(
        select(func.max(evaluation_versions.c.number)).where(
            evaluation_versions.c.task_id == row.task_id,
            evaluation_versions.c.signed_at.is_not(None),
        )
    )
    await connection.execute(
        insert(evaluation_changes).values(
            tenant_id=row.tenant_id,
            task_id=row.task_id,
            version=version or 1,
            slide_id=row.slide_id,
            object_id=object_code,
            change=change.value,
            reason=reason.strip(),
            changed_by_user_id=user_of(principal),
        )
    )
