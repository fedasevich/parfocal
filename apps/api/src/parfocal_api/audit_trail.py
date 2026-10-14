import uuid

from fastapi import APIRouter
from sqlalchemy import and_, literal_column, select

from parfocal_api.audit import AuditEvent, AuditTarget, event_of
from parfocal_api.context import TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.tables import audit_events, audit_people
from parfocal_common.db import CURRENT_TENANT

router = APIRouter(prefix="/api/tenant", tags=["audit"])


@router.get("/audit-events", operation_id="listAuditEvents", **require(Permission.AUDIT_LOG))
async def list_audit_events(
    connection: TenantConnection,
    target_type: AuditTarget | None = None,
    target_id: uuid.UUID | None = None,
) -> list[AuditEvent]:
    actor = audit_people.alias("actor")
    target = audit_people.alias("target")
    statement = (
        select(
            audit_events,
            actor.c.subject.label("actor_subject"),
            target.c.subject.label("target_subject"),
        )
        .outerjoin(actor, actor.c.id == audit_events.c.actor_id)
        .outerjoin(
            target,
            and_(
                target.c.id == audit_events.c.target_id,
                audit_events.c.target_type == AuditTarget.PERSON,
            ),
        )
        .where(audit_events.c.tenant_id == literal_column(CURRENT_TENANT))
    )
    if target_type is not None:
        statement = statement.where(audit_events.c.target_type == target_type)
    if target_id is not None:
        statement = statement.where(audit_events.c.target_id == target_id)
    rows = await connection.execute(statement.order_by(audit_events.c.seq))
    return [event_of(row) for row in rows]
