import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.case_creation import privacy_of, require_owner
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.notification_catalogue import TargetKind
from parfocal_api.notifications import deliver_after_commit, notify
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal, database_scope
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.slide_details import require_free_label
from parfocal_api.tables import (
    NotificationKind,
    cases,
    result_sets,
    review_task_slides,
    review_tasks,
    slides,
)

MoveReason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=500)]


class SlideMove(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: uuid.UUID
    reason: MoveReason


class SlideMoved(BaseModel):
    slide_id: uuid.UUID
    from_case_id: uuid.UUID | None
    to_case_id: uuid.UUID
    result_set_ids: list[uuid.UUID]
    task_ids: list[uuid.UUID]
    block_cleared: bool


class SameCaseError(BadRequestError):
    code = "slide-already-in-case"
    title = "The slide is already in this case"


class CaseOutsideProjectError(BadRequestError):
    code = "case-outside-project"
    title = "A slide moves only to another case in its own project"


class HeldBySignedOffTaskError(ConflictError):
    code = "task-signed-off"
    title = "A task that holds this slide is signed off. An owner can reopen it"


router = APIRouter(tags=["slides"])


async def target_case(
    connection: AsyncConnection, case_id: uuid.UUID, project_id: uuid.UUID
) -> None:
    found = await connection.scalar(
        select(cases.c.project_id).where(cases.c.id == case_id, cases.c.deleted_at.is_(None))
    )
    if found is None:
        raise NotFoundError("Case not found")
    if found != project_id:
        raise CaseOutsideProjectError


async def holding_tasks(connection: AsyncConnection, slide_id: uuid.UUID) -> list[uuid.UUID]:
    held = (
        await connection.execute(
            select(
                review_tasks.c.id,
                review_tasks.c.signed_off_at,
                review_task_slides.c.signed_off_at.label("slide_signed_off_at"),
            )
            .join(review_tasks, review_tasks.c.id == review_task_slides.c.task_id)
            .where(review_task_slides.c.slide_id == slide_id)
            .order_by(review_tasks.c.id)
            .with_for_update()
        )
    ).all()
    if any(row.signed_off_at is not None or row.slide_signed_off_at is not None for row in held):
        raise HeldBySignedOffTaskError
    return [row.id for row in held]


async def researchers_of(
    connection: AsyncConnection, task_ids: list[uuid.UUID], principal: Principal
) -> list[uuid.UUID]:
    if not task_ids:
        return []
    mover = principal.user_id if isinstance(principal, MemberPrincipal) else None
    people = await connection.scalars(
        select(review_tasks.c.created_by_user_id)
        .where(review_tasks.c.id.in_(task_ids), review_tasks.c.created_by_user_id.is_not(None))
        .distinct()
    )
    return sorted(person for person in people if person != mover)


@router.post(
    "/api/slides/{slide_id}/move",
    operation_id="moveSlide",
    **require(Permission.CREATE_CASES, write=True),
)
async def move_slide(
    slide_id: uuid.UUID,
    move: SlideMove,
    http: Request,
    background: BackgroundTasks,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> SlideMoved:
    slide = (
        await connection.execute(
            select(slides).where(slides.c.id == slide_id, slides.c.deleted_at.is_(None))
        )
    ).one_or_none()
    if slide is None:
        raise NotFoundError("Slide not found")
    await privacy_of(connection, slide.project_id)
    await require_owner(connection, principal, slide.project_id)
    if slide.case_id == move.case_id:
        raise SameCaseError
    await target_case(connection, move.case_id, slide.project_id)
    await require_free_label(connection, slide_id, slide.project_id, move.case_id, slide.label)
    task_ids = await holding_tasks(connection, slide_id)
    await connection.execute(
        update(slides)
        .where(slides.c.id == slide_id)
        .values(case_id=move.case_id, block_id=None, position=None)
    )
    sets = list(
        (
            await connection.scalars(
                select(result_sets.c.id)
                .where(result_sets.c.slide_id == slide_id, result_sets.c.deleted_at.is_(None))
                .order_by(result_sets.c.created_at, result_sets.c.id)
            )
        ).all()
    )
    tenant_id = database_scope(principal).tenant_id
    shared = {
        "slide_id": str(slide_id),
        "from_case_id": str(slide.case_id) if slide.case_id else None,
        "to_case_id": str(move.case_id),
        "reason": move.reason,
        "result_sets": len(sets),
        "tasks": len(task_ids),
        "block_cleared": slide.block_id is not None,
    }
    sides = [("in", move.case_id)]
    if slide.case_id is not None:
        sides.insert(0, ("out", slide.case_id))
    for direction, case_id in sides:
        await record(
            connection,
            actor_of(principal),
            AuditAction.CASE_SLIDE_MOVED,
            AuditTarget.CASE,
            case_id,
            tenant_id=tenant_id,
            details={**shared, "direction": direction},
        )
    recipients = await researchers_of(connection, task_ids, principal)
    if recipients and tenant_id is not None:
        await notify(
            connection,
            tenant_id,
            recipients,
            NotificationKind.SLIDE_MOVED,
            TargetKind.SLIDE,
            slide_id,
            {"to_case_id": str(move.case_id)},
        )
        background.add_task(deliver_after_commit, http.app, tenant_id)
    return SlideMoved(
        slide_id=slide_id,
        from_case_id=slide.case_id,
        to_case_id=move.case_id,
        result_set_ids=sets,
        task_ids=task_ids,
        block_cleared=slide.block_id is not None,
    )
