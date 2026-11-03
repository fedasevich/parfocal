import uuid
from typing import Annotated

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.case_creation import privacy_of, require_owner
from parfocal_api.cases import CASE_SLIDE_ORDER, CaseDetail, SlideDetail, case_detail, keyring_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal, database_scope
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import project_grant, reads_whole
from parfocal_api.restricted_images import sees_restricted, shown
from parfocal_api.tables import PrivacyMode, blocks, cases, slides

Stain = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
SlideLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class SlideDetailsChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stain: Stain | None = None
    block_id: uuid.UUID | None = None
    level: Annotated[int, Field(ge=1, le=50)] | None = None
    label: SlideLabel | None = None

    @field_validator("stain", "label")
    @classmethod
    def present(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("Give a value or leave the field out")
        return value


class SlideOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slide_ids: Annotated[list[uuid.UUID], Field(max_length=500)]


class BlockOutsideCaseError(BadRequestError):
    code = "block-outside-case"
    title = "The block belongs to another case, or the slide has no case"


class SlideLabelTakenError(ConflictError):
    code = "slide-label-taken"
    title = "Another slide in this case already has this label"


class SlideLabelHiddenError(ForbiddenError):
    code = "slide-label-hidden"
    title = "Only people who see slide labels in this clinical project change label text"


class SlideOutsideCaseError(BadRequestError):
    code = "slide-outside-case"
    title = "Every slide in the order must belong to this case, once"


router = APIRouter(tags=["slides"])


async def require_label_access(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, mode: PrivacyMode
) -> None:
    if mode is not PrivacyMode.CLINICAL:
        return
    if not reads_whole(
        await project_grant(connection, principal, project_id, Permission.SEE_LABELS)
    ):
        raise SlideLabelHiddenError


async def require_block_in_case(
    connection: AsyncConnection, block_id: uuid.UUID, case_id: uuid.UUID | None
) -> None:
    if case_id is None:
        raise BlockOutsideCaseError
    found = await connection.scalar(
        select(blocks.c.id).where(
            blocks.c.id == block_id, blocks.c.case_id == case_id, blocks.c.deleted_at.is_(None)
        )
    )
    if found is None:
        raise BlockOutsideCaseError


async def require_free_label(
    connection: AsyncConnection,
    slide_id: uuid.UUID,
    project_id: uuid.UUID,
    case_id: uuid.UUID | None,
    label: str,
) -> None:
    same_place = (
        slides.c.case_id == case_id
        if case_id is not None
        else (slides.c.project_id == project_id) & slides.c.case_id.is_(None)
    )
    taken = await connection.scalar(
        select(slides.c.id).where(
            same_place,
            slides.c.label == label,
            slides.c.id != slide_id,
            slides.c.deleted_at.is_(None),
        )
    )
    if taken is not None:
        raise SlideLabelTakenError


@router.patch(
    "/api/slides/{slide_id}",
    operation_id="changeSlideDetails",
    **require(Permission.CREATE_CASES, write=True),
)
async def change_slide_details(
    slide_id: uuid.UUID,
    change: SlideDetailsChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> SlideDetail:
    slide = (
        await connection.execute(
            select(slides).where(slides.c.id == slide_id, slides.c.deleted_at.is_(None))
        )
    ).one_or_none()
    if slide is None:
        raise NotFoundError("Slide not found")
    mode = await privacy_of(connection, slide.project_id)
    await require_owner(connection, principal, slide.project_id)
    given = change.model_dump(include=change.model_fields_set)
    if "label" in given:
        await require_label_access(connection, principal, slide.project_id, mode)
        await require_free_label(
            connection, slide_id, slide.project_id, slide.case_id, given["label"]
        )
    if given.get("block_id") is not None:
        await require_block_in_case(connection, given["block_id"], slide.case_id)
    changed = {name: value for name, value in given.items() if getattr(slide, name) != value}
    if changed:
        await connection.execute(update(slides).where(slides.c.id == slide_id).values(**changed))
        await record(
            connection,
            actor_of(principal),
            AuditAction.SLIDE_DETAILS_CHANGED,
            AuditTarget.SLIDE,
            slide_id,
            tenant_id=database_scope(principal).tenant_id,
            details={"fields": sorted(changed)},
        )
    row = (await connection.execute(select(slides).where(slides.c.id == slide_id))).one()
    visible = await sees_restricted(connection, principal, slide.project_id, mode)
    return SlideDetail(
        id=row.id,
        label=row.label,
        block_id=row.block_id,
        barcode=row.barcode,
        stain=row.stain,
        level=row.level,
        restricted_images=shown(row.restricted_images, visible),
    )


@router.put(
    "/api/cases/{case_id}/slide-order",
    operation_id="reorderCaseSlides",
    **require(Permission.CREATE_CASES, write=True),
)
async def reorder_case_slides(
    case_id: uuid.UUID,
    order: SlideOrder,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseDetail:
    project_id = await connection.scalar(
        select(cases.c.project_id).where(cases.c.id == case_id, cases.c.deleted_at.is_(None))
    )
    if project_id is None:
        raise NotFoundError("Case not found")
    await privacy_of(connection, project_id)
    await require_owner(connection, principal, project_id)
    current = list(
        (
            await connection.scalars(
                select(slides.c.id)
                .where(slides.c.case_id == case_id, slides.c.deleted_at.is_(None))
                .order_by(*CASE_SLIDE_ORDER)
            )
        ).all()
    )
    listed = order.slide_ids
    if len(set(listed)) != len(listed) or not set(listed) <= set(current):
        raise SlideOutsideCaseError
    ordered = [*listed, *(slide for slide in current if slide not in set(listed))]
    for position, slide in enumerate(ordered):
        await connection.execute(
            update(slides).where(slides.c.id == slide).values(position=position)
        )
    await record(
        connection,
        actor_of(principal),
        AuditAction.CASE_SLIDES_REORDERED,
        AuditTarget.CASE,
        case_id,
        tenant_id=database_scope(principal).tenant_id,
        details={
            "slides": len(ordered),
            "moved": sum(a != b for a, b in zip(current, ordered, strict=True)),
        },
    )
    return await case_detail(
        connection, keyring_of(request), principal, case_id, patient_viewed=False
    )
