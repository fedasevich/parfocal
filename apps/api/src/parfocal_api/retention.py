import asyncio
import uuid
from collections import Counter
from collections.abc import Mapping
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import exists, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_api.audit import Actor, AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import NotFoundError
from parfocal_api.settings import ApiSettings
from parfocal_api.tables import (
    MIN_AUDIT_DAYS,
    ActorKind,
    jobs,
    legal_holds,
    projects,
    retention_policies,
    tenants,
)
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.jobs import PLATFORM, Step, StepRun, Workflow, enqueue, work
from parfocal_common.settings import load_settings

SYSTEM = Actor(ActorKind.SYSTEM)
DAILY = timedelta(hours=20)
TARGETS = {
    "annotation": AuditTarget.ANNOTATION,
    "result-set": AuditTarget.RESULT_SET,
    "slide": AuditTarget.SLIDE,
}

HoldReason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class RetentionPolicy(BaseModel):
    deleted_after_days: Annotated[int, Field(ge=1)] | None = None
    audit_after_days: Annotated[int, Field(ge=MIN_AUDIT_DAYS)] | None = None


class LegalHoldDraft(BaseModel):
    project_id: uuid.UUID | None = None
    reason: HoldReason


class LegalHold(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID | None
    reason: str
    placed_by_user_id: uuid.UUID | None
    created_at: datetime
    released_at: datetime | None


class HoldNotFoundError(NotFoundError):
    code = "legal-hold-not-found"
    title = "There is no such legal hold"


class HoldProjectNotFoundError(NotFoundError):
    code = "project-not-found"
    title = "There is no such project in this workspace"


router = APIRouter(prefix="/api/tenant", tags=["tenant"])


def hold_of(row: Any) -> LegalHold:
    return LegalHold(
        id=row.id,
        project_id=row.project_id,
        reason=row.reason,
        placed_by_user_id=row.placed_by_user_id,
        created_at=row.created_at,
        released_at=row.released_at,
    )


@router.get(
    "/retention", operation_id="getRetentionPolicy", **require(Permission.WORKSPACE_SETTINGS)
)
async def get_retention_policy(connection: TenantConnection) -> RetentionPolicy:
    row = (await connection.execute(select(retention_policies))).one_or_none()
    if row is None:
        return RetentionPolicy()
    return RetentionPolicy(
        deleted_after_days=row.deleted_after_days, audit_after_days=row.audit_after_days
    )


@router.put(
    "/retention",
    operation_id="setRetentionPolicy",
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def set_retention_policy(
    policy: RetentionPolicy, principal: CurrentPrincipal, connection: TenantConnection
) -> RetentionPolicy:
    tenant_id = database_scope(principal).tenant_id
    values = policy.model_dump()
    await connection.execute(
        upsert(retention_policies)
        .values(tenant_id=tenant_id, **values)
        .on_conflict_do_update(index_elements=[retention_policies.c.tenant_id], set_=values)
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.RETENTION_POLICY_SET,
        AuditTarget.TENANT,
        tenant_id,
        tenant_id=tenant_id,
        details=values,
    )
    return policy


@router.get("/legal-holds", operation_id="listLegalHolds", **require(Permission.WORKSPACE_SETTINGS))
async def list_legal_holds(connection: TenantConnection) -> list[LegalHold]:
    rows = await connection.execute(
        select(legal_holds).order_by(legal_holds.c.created_at.desc(), legal_holds.c.id)
    )
    return [hold_of(row) for row in rows]


@router.post(
    "/legal-holds",
    operation_id="placeLegalHold",
    status_code=status.HTTP_201_CREATED,
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def place_legal_hold(
    draft: LegalHoldDraft, principal: CurrentPrincipal, connection: TenantConnection
) -> LegalHold:
    tenant_id = database_scope(principal).tenant_id
    if draft.project_id is not None and not await connection.scalar(
        select(exists().where(projects.c.id == draft.project_id))
    ):
        raise HoldProjectNotFoundError
    row = (
        await connection.execute(
            insert(legal_holds)
            .values(
                tenant_id=tenant_id,
                project_id=draft.project_id,
                reason=draft.reason,
                placed_by_user_id=user_of(principal),
            )
            .returning(legal_holds)
        )
    ).one()
    await record(
        connection,
        actor_of(principal),
        AuditAction.LEGAL_HOLD_PLACED,
        AuditTarget.LEGAL_HOLD,
        row.id,
        tenant_id=tenant_id,
        details={"project_id": str(draft.project_id) if draft.project_id else None},
    )
    return hold_of(row)


@router.post(
    "/legal-holds/{hold_id}/release",
    operation_id="releaseLegalHold",
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def release_legal_hold(
    hold_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> LegalHold:
    released = (
        await connection.execute(
            update(legal_holds)
            .where(legal_holds.c.id == hold_id, legal_holds.c.released_at.is_(None))
            .values(released_at=func.now(), released_by_user_id=user_of(principal))
            .returning(legal_holds)
        )
    ).one_or_none()
    if released is None:
        found = (
            await connection.execute(select(legal_holds).where(legal_holds.c.id == hold_id))
        ).one_or_none()
        if found is None:
            raise HoldNotFoundError
        return hold_of(found)
    await record(
        connection,
        actor_of(principal),
        AuditAction.LEGAL_HOLD_RELEASED,
        AuditTarget.LEGAL_HOLD,
        released.id,
        tenant_id=released.tenant_id,
    )
    return hold_of(released)


async def purge(connection: AsyncConnection, tenant_id: uuid.UUID) -> dict[str, int]:
    rows = (
        await connection.execute(text("SELECT kind, id, detail FROM parfocal_retention_purge()"))
    ).all()
    counts: Counter[str] = Counter()
    for row in rows:
        counts[row.kind] += 1
        if row.kind in TARGETS:
            await record(
                connection,
                SYSTEM,
                AuditAction.RETENTION_PURGED,
                TARGETS[row.kind],
                row.id,
                tenant_id=tenant_id,
            )
        elif row.kind == "audit":
            counts["audit"] = int(row.detail["count"])
            await record(
                connection,
                SYSTEM,
                AuditAction.AUDIT_PURGED,
                AuditTarget.TENANT,
                tenant_id,
                tenant_id=tenant_id,
                details=dict(row.detail),
            )
    return dict(counts)


async def purge_step(step: StepRun) -> Mapping[str, Any]:
    async with step.transaction() as connection:
        return await purge(connection, step.tenant_id)


RETENTION = Workflow(kind="retention", steps=[Step("purge", purge_step)], lease_seconds=300)


async def schedule_retention(engine: AsyncEngine) -> list[uuid.UUID]:
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant_ids = list(await connection.scalars(select(tenants.c.id).order_by(tenants.c.id)))
    scheduled: list[uuid.UUID] = []
    for tenant_id in tenant_ids:
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            has_policy = await connection.scalar(
                select(exists().where(retention_policies.c.tenant_id == tenant_id))
            )
            recent = await connection.scalar(
                select(
                    exists().where(
                        jobs.c.kind == RETENTION.kind,
                        jobs.c.created_at > func.now() - DAILY,
                    )
                )
            )
            if has_policy and not recent:
                scheduled.append(await enqueue(connection, RETENTION, tenant_id))
    return scheduled


async def run_once(settings: ApiSettings) -> int:
    engine = create_engine(str(settings.database_url))
    try:
        await schedule_retention(engine)
        return await work(engine, [RETENTION], "retention", idle_exit_seconds=1, poll_seconds=0.5)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_once(load_settings(ApiSettings)))
