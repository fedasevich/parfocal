import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import ConfigDict
from sqlalchemy import func, insert, literal_column, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.notifications import deliver_after_commit, notify
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ConflictError, NotFoundError
from parfocal_api.study_templates import (
    StudyTemplate,
    StudyTemplateDraft,
    content,
    create_template,
)
from parfocal_api.tables import (
    NotificationKind,
    TemplateOfferStatus,
    memberships,
    template_offers,
)
from parfocal_common.db import CURRENT_TENANT

router = APIRouter(prefix="/api/template-offers", tags=["template-offers"])


class TemplateOffer(StudyTemplateDraft):
    model_config = ConfigDict(extra="ignore")

    id: uuid.UUID
    offered_by_user_id: uuid.UUID
    status: TemplateOfferStatus
    template_id: uuid.UUID | None
    created_at: datetime
    decided_at: datetime | None


class TemplateOfferDecidedError(ConflictError):
    code = "template-offer-decided"
    title = "This offer has already been decided"


class TemplateOfferNotFoundError(NotFoundError):
    code = "template-offer-not-found"


def offer_of(row: Any) -> TemplateOffer:
    return TemplateOffer.model_validate(row, from_attributes=True)


async def pending_offer(connection: AsyncConnection, offer_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(select(template_offers).where(template_offers.c.id == offer_id))
    ).one_or_none()
    if row is None:
        raise TemplateOfferNotFoundError("Template offer not found")
    if row.status != TemplateOfferStatus.PENDING:
        raise TemplateOfferDecidedError
    return row


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    offer_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.TEMPLATE_OFFER,
        offer_id,
        tenant_id=tenant_id,
    )


def user_of(principal: Principal) -> uuid.UUID:
    assert isinstance(principal, MemberPrincipal)
    return principal.user_id


@router.post(
    "",
    operation_id="offerStudyTemplate",
    status_code=201,
    **require(Permission.REPORT_TEMPLATES),
)
async def offer_study_template(
    draft: StudyTemplateDraft,
    request: Request,
    background: BackgroundTasks,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> TemplateOffer:
    tenant_id = await connection.scalar(select(literal_column(CURRENT_TENANT)))
    assert isinstance(tenant_id, uuid.UUID)
    row = (
        await connection.execute(
            insert(template_offers)
            .values(tenant_id=tenant_id, offered_by_user_id=user_of(principal), **content(draft))
            .returning(*template_offers.c)
        )
    ).one()
    await audit(connection, principal, AuditAction.TEMPLATE_OFFERED, row.id, tenant_id)
    admins = await connection.scalars(
        select(memberships.c.user_id).where(
            memberships.c.tenant_id == tenant_id, memberships.c.admin_rights.is_(True)
        )
    )
    await notify(
        connection,
        tenant_id,
        [admin for admin in admins.all() if admin != user_of(principal)],
        NotificationKind.TEMPLATE_OFFERED,
        AuditTarget.TEMPLATE_OFFER,
        row.id,
        {"name": draft.name},
    )
    background.add_task(deliver_after_commit, request.app, tenant_id)
    return offer_of(row)


@router.get(
    "",
    operation_id="listTemplateOffers",
    **require(Permission.REPORT_TEMPLATES, write=True),
)
async def list_template_offers(connection: TenantConnection) -> list[TemplateOffer]:
    rows = await connection.execute(
        select(template_offers)
        .where(template_offers.c.status == TemplateOfferStatus.PENDING)
        .order_by(template_offers.c.created_at, template_offers.c.id)
    )
    return [offer_of(row) for row in rows]


@router.post(
    "/{offer_id}/acceptance",
    operation_id="acceptTemplateOffer",
    **require(Permission.REPORT_TEMPLATES, write=True),
)
async def accept_template_offer(
    offer_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> StudyTemplate:
    row = await pending_offer(connection, offer_id)
    draft = StudyTemplateDraft.model_validate(
        {
            "name": row.name,
            "study_kind": row.study_kind,
            "blocks": row.blocks,
            "format": row.format,
            "presets": row.presets,
        }
    )
    template = await create_template(connection, principal, draft)
    await connection.execute(
        update(template_offers)
        .where(template_offers.c.id == offer_id)
        .values(
            status=TemplateOfferStatus.ACCEPTED,
            template_id=template.id,
            decided_at=func.now(),
            decided_by_user_id=user_of(principal),
        )
    )
    await audit(connection, principal, AuditAction.TEMPLATE_OFFER_ACCEPTED, offer_id, row.tenant_id)
    return template


@router.post(
    "/{offer_id}/decline",
    operation_id="declineTemplateOffer",
    status_code=204,
    **require(Permission.REPORT_TEMPLATES, write=True),
)
async def decline_template_offer(
    offer_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> None:
    row = await pending_offer(connection, offer_id)
    await connection.execute(
        update(template_offers)
        .where(template_offers.c.id == offer_id)
        .values(
            status=TemplateOfferStatus.DECLINED,
            decided_at=func.now(),
            decided_by_user_id=user_of(principal),
        )
    )
    await audit(connection, principal, AuditAction.TEMPLATE_OFFER_DECLINED, offer_id, row.tenant_id)
