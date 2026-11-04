import secrets
import string
import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import Actor, AuditAction, AuditTarget, actor_of, record
from parfocal_api.auth import AUTH_SCOPE, auth_state, digest
from parfocal_api.context import CurrentPrincipal, TenantConnection, engine_of
from parfocal_api.evaluation import (
    ClassMetrics,
    DecisionCounts,
    Evaluation,
    RateOut,
    evaluate,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import NotFoundError, ProblemError, TooManyRequestsError
from parfocal_api.projects import owned
from parfocal_api.rate_limits import report_link_wait
from parfocal_api.review_tasks import readable_task
from parfocal_api.tables import (
    ActorKind,
    TenantStatus,
    projects,
    report_links,
    review_tasks,
    tenants,
)
from parfocal_common.db import DatabaseScope, scoped_transaction

LINK_LIFETIME = timedelta(days=30)
SHARED_PATH = "/shared-reports"
LINK_ACTOR = Actor(ActorKind.SYSTEM)


class ReportLink(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    created_by: uuid.UUID | None
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    expired: bool
    opened_count: int
    last_opened_at: datetime | None


class CreatedReportLink(ReportLink):
    token: str
    url: str


class SharedKappa(BaseModel):
    first: str
    second: str
    value: float | None
    objects: int


class SharedOpinion(BaseModel):
    key: str
    count: int
    mean: float | None
    spread: float | None
    counts: dict[str, int]


class SharedEvaluation(BaseModel):
    sample: bool
    decisions: DecisionCounts
    classes: list[ClassMetrics]
    overall: list[ClassMetrics]
    dice: dict[str, RateOut]
    kappa: list[SharedKappa]
    mean_kappa: float | None
    fleiss_kappa: float | None
    cell_agreement_with_ai: RateOut
    cell_agreement_between_reviewers: RateOut
    reasons: list[tuple[str, int]]
    opinions: list[SharedOpinion]


class SharedReport(BaseModel):
    project_name: str
    task_name: str
    expires_at: datetime
    evaluation: SharedEvaluation


class ReportLinkGoneError(ProblemError):
    status = 410
    code = "report-link-gone"
    title = "This report link was revoked or has expired"


EXPIRED = (report_links.c.expires_at <= func.now()).label("expired")

router = APIRouter(prefix="/api/review-tasks/{task_id}/evaluation/links", tags=["review-tasks"])
public_router = APIRouter(prefix="/api/shared-reports", tags=["shared-reports"])


def link_of(row: Any) -> ReportLink:
    return ReportLink(
        id=row.id,
        task_id=row.task_id,
        created_by=row.created_by_user_id,
        created_at=row.created_at,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        expired=row.expired,
        opened_count=row.opened_count,
        last_opened_at=row.last_opened_at,
    )


async def owned_task(connection: AsyncConnection, principal: Principal, task_id: uuid.UUID) -> Any:
    task, _ = await readable_task(connection, principal, task_id)
    await owned(connection, principal, task.project_id)
    return task


def user_of(principal: Principal) -> uuid.UUID | None:
    user_id = getattr(principal, "user_id", None)
    return user_id if isinstance(user_id, uuid.UUID) else None


@router.post(
    "",
    operation_id="createReportLink",
    status_code=201,
    **require(Permission.CREATE_CASES, write=True),
)
async def create_report_link(
    task_id: uuid.UUID,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CreatedReportLink:
    task = await owned_task(connection, principal, task_id)
    token = secrets.token_urlsafe(32)
    row = (
        await connection.execute(
            insert(report_links)
            .values(
                tenant_id=task.tenant_id,
                task_id=task.id,
                token_hash=digest(token),
                created_by_user_id=user_of(principal),
                expires_at=func.now() + LINK_LIFETIME,
            )
            .returning(*report_links.c, EXPIRED)
        )
    ).one()
    await record(
        connection,
        actor_of(principal),
        AuditAction.REPORT_LINK_CREATED,
        AuditTarget.REPORT_LINK,
        row.id,
        tenant_id=task.tenant_id,
        details={"task_id": str(task.id), "expires_at": row.expires_at.isoformat()},
    )
    url = f"{auth_state(request).public_origin}{SHARED_PATH}/{token}"
    return CreatedReportLink(**link_of(row).model_dump(), token=token, url=url)


@router.get("", operation_id="listReportLinks", **require(Permission.CREATE_CASES))
async def list_report_links(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[ReportLink]:
    task = await owned_task(connection, principal, task_id)
    rows = await connection.execute(
        select(*report_links.c, EXPIRED)
        .where(report_links.c.task_id == task.id)
        .order_by(report_links.c.created_at, report_links.c.id)
    )
    return [link_of(row) for row in rows]


@router.delete(
    "/{link_id}",
    operation_id="revokeReportLink",
    status_code=204,
    **require(Permission.CREATE_CASES, write=True),
)
async def revoke_report_link(
    task_id: uuid.UUID,
    link_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Response:
    task = await owned_task(connection, principal, task_id)
    found = await connection.scalar(
        select(report_links.c.revoked_at.is_(None)).where(
            report_links.c.id == link_id, report_links.c.task_id == task.id
        )
    )
    if found is None:
        raise NotFoundError("Report link not found")
    if found:
        await connection.execute(
            update(report_links).where(report_links.c.id == link_id).values(revoked_at=func.now())
        )
        await record(
            connection,
            actor_of(principal),
            AuditAction.REPORT_LINK_REVOKED,
            AuditTarget.REPORT_LINK,
            link_id,
            tenant_id=task.tenant_id,
            details={"task_id": str(task.id)},
        )
    return Response(status_code=204)


def letters(evaluation: Evaluation) -> dict[uuid.UUID, str]:
    people = sorted(
        {pair.first for pair in evaluation.kappa} | {pair.second for pair in evaluation.kappa},
        key=str,
    )
    names = string.ascii_uppercase
    return {
        person: f"Reviewer {names[index % 26]}{index // 26 or ''}"
        for index, person in enumerate(people)
    }


def shared_of(evaluation: Evaluation) -> SharedEvaluation:
    named = letters(evaluation)
    return SharedEvaluation(
        sample=evaluation.sample,
        decisions=evaluation.decisions,
        classes=evaluation.classes,
        overall=evaluation.overall,
        dice=evaluation.dice,
        mean_kappa=evaluation.mean_kappa,
        fleiss_kappa=evaluation.fleiss_kappa,
        cell_agreement_with_ai=evaluation.cell_agreement_with_ai,
        cell_agreement_between_reviewers=evaluation.cell_agreement_between_reviewers,
        reasons=evaluation.reasons,
        kappa=[
            SharedKappa(
                first=named[pair.first],
                second=named[pair.second],
                value=pair.value,
                objects=pair.objects,
            )
            for pair in evaluation.kappa
        ],
        opinions=[
            SharedOpinion(
                key=item.key,
                count=item.count,
                mean=item.mean,
                spread=item.spread,
                counts=item.counts,
            )
            for item in evaluation.opinions
        ],
    )


@public_router.get("/{token}", operation_id="getSharedReport")
async def get_shared_report(token: str, request: Request) -> SharedReport:
    engine = engine_of(request)
    hashed = digest(token)
    async with scoped_transaction(engine, AUTH_SCOPE) as connection:
        found = (
            await connection.execute(
                select(report_links.c.id, report_links.c.tenant_id).where(
                    report_links.c.token_hash == hashed
                )
            )
        ).one_or_none()
        wait = (
            None
            if found is None
            else await report_link_wait(connection, found.id, auth_state(request).limits)
        )
    if found is None:
        raise NotFoundError("Report link not found")
    if wait is not None:
        raise TooManyRequestsError(wait)
    tenant_id = found.tenant_id
    async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
        link = (
            await connection.execute(
                select(*report_links.c, EXPIRED).where(report_links.c.token_hash == hashed)
            )
        ).one()
        status = await connection.scalar(select(tenants.c.status).where(tenants.c.id == tenant_id))
        if status == TenantStatus.SUSPENDED:
            raise NotFoundError("Report link not found")
        gone = link.revoked_at is not None or link.expired
        shared = None if gone else await shared_report(connection, link)
        await record(
            connection,
            LINK_ACTOR,
            AuditAction.REPORT_LINK_OPENED,
            AuditTarget.REPORT_LINK,
            link.id,
            tenant_id=tenant_id,
            details={"task_id": str(link.task_id), "refused": gone},
        )
    if shared is None:
        raise ReportLinkGoneError
    return shared


async def shared_report(connection: AsyncConnection, link: Any) -> SharedReport:
    task = (
        await connection.execute(select(review_tasks).where(review_tasks.c.id == link.task_id))
    ).one()
    project_name = await connection.scalar(
        select(projects.c.name).where(projects.c.id == task.project_id)
    )
    evaluation = await evaluate(connection, task)
    await connection.execute(
        update(report_links)
        .where(report_links.c.id == link.id)
        .values(opened_count=report_links.c.opened_count + 1, last_opened_at=func.now())
    )
    return SharedReport(
        project_name=str(project_name),
        task_name=task.name,
        expires_at=link.expires_at,
        evaluation=shared_of(evaluation),
    )
