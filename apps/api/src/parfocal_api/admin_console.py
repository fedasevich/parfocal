import uuid
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget
from parfocal_api.auth import auth_state
from parfocal_api.context import TenantConnection
from parfocal_api.hidden_models import hidden_names
from parfocal_api.model_area import running_now
from parfocal_api.model_catalogue import CATALOGUE
from parfocal_api.permissions import Permission, require, sign_out_right
from parfocal_api.projects import code_of
from parfocal_api.remote_reads import OFFLINE_AFTER_FAILURES
from parfocal_api.tables import (
    AttemptOutcome,
    PrivacyMode,
    ProjectRole,
    Role,
    SlideStorage,
    audit_events,
    event_attempts,
    event_outbox,
    event_targets,
    import_sources,
    invitations,
    lab_models,
    memberships,
    project_members,
    project_webhooks,
    projects,
    slides,
    sso_connections,
)
from parfocal_common.db import CURRENT_TENANT

TERABYTE = 1000**4
GIGABYTE = 1000**3


class AdminOverview(BaseModel):
    people: int = Field(ge=0)
    researchers: int = Field(ge=0)
    reviewers: int = Field(ge=0)
    with_admin_rights: int = Field(ge=0)
    can_sign_out_user_ids: list[uuid.UUID]
    projects: int = Field(ge=0)
    invites_waiting: int = Field(ge=0)
    models: int = Field(ge=0)
    runs_now: int = Field(ge=0)
    stored_tb: float = Field(ge=0)
    capacity_tb: float | None = Field(ge=0)
    in_place_tb: float = Field(ge=0)
    webhook_calls_today: int = Field(ge=0)
    webhook_rejected_today: int = Field(ge=0)


class StoragePart(BaseModel):
    kind: str
    label: str
    tb: float = Field(ge=0)
    bytes: int = Field(ge=0)


class StorageProjectRef(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class ProjectStorage(BaseModel):
    project: StorageProjectRef
    colour: int = Field(ge=0)
    gb: float = Field(ge=0)
    bytes: int = Field(ge=0)
    cap_gb: float | None = Field(ge=0)


class StorageRule(BaseModel):
    key: str
    label: str
    detail: str
    on: bool
    locked: bool


class StorageSource(BaseModel):
    id: uuid.UUID
    name: str
    kind: Literal["s3", "dicomweb", "https", "azure"]
    access: str
    address: str
    new_slides: Literal["copied", "in-place"]
    health: Literal["answering", "expiring", "unreachable", "unused"]
    first_tile_ms: int | None = Field(ge=0)
    expires_in_days: int | None = Field(ge=0)
    slides_in_place: int = Field(ge=0)
    last_read_at: datetime | None


class StorageUsage(BaseModel):
    total_tb: float = Field(ge=0)
    total_bytes: int = Field(ge=0)
    capacity_tb: float | None = Field(ge=0)
    in_place_tb: float = Field(ge=0)
    in_place_bytes: int = Field(ge=0)
    parts: list[StoragePart]
    by_project: list[ProjectStorage]
    rules: list[StorageRule]
    sources: list[StorageSource]


class SecuritySetting(BaseModel):
    key: str
    label: str
    detail: str
    on: bool
    locked: bool


class TwoFactorShare(BaseModel):
    people: int = Field(ge=0)
    of: int = Field(ge=0)


class SecuritySettings(BaseModel):
    sign_in: list[SecuritySetting]
    two_factor: TwoFactorShare | None


class Webhook(BaseModel):
    id: uuid.UUID
    name: str
    direction: Literal["incoming", "outgoing"]
    events: list[str]
    calls_today: int = Field(ge=0)
    rejected_today: int = Field(ge=0)
    project: StorageProjectRef | None = None
    address: str | None = None
    paused: bool = False


router = APIRouter(prefix="/api/tenant", tags=["tenant"])

IN_THIS_TENANT: ColumnElement[uuid.UUID] = literal_column(CURRENT_TENANT)
INCOMING_EVENTS = ("slide", "results")
READ_ONLY_RULE = StorageRule(
    key="read-only-keys",
    label="Read-only keys only",
    detail="Parfocal never writes to a source",
    on=True,
    locked=True,
)


def terabytes(size: int) -> float:
    return round(size / TERABYTE, 3)


LIVE_SLIDES = slides.c.deleted_at.is_(None)
COPIED = slides.c.storage != SlideStorage.REMOTE
IN_PLACE = slides.c.storage == SlideStorage.REMOTE


def bytes_where(condition: ColumnElement[bool]) -> ColumnElement[int]:
    return func.coalesce(func.sum(slides.c.file_bytes).filter(condition), 0)


async def slide_bytes(connection: AsyncConnection) -> tuple[int, int]:
    row = (
        await connection.execute(
            select(bytes_where(COPIED), bytes_where(IN_PLACE)).where(LIVE_SLIDES)
        )
    ).one()
    return int(row[0]), int(row[1])


def today() -> ColumnElement[datetime]:
    return func.date_trunc("day", func.now())


async def incoming_counts(connection: AsyncConnection) -> dict[uuid.UUID, tuple[int, int]]:
    rows = await connection.execute(
        select(
            audit_events.c.target_id,
            func.count(),
            func.count().filter(audit_events.c.action == AuditAction.WEBHOOK_REJECTED),
        )
        .where(
            audit_events.c.tenant_id == IN_THIS_TENANT,
            audit_events.c.target_type == AuditTarget.WEBHOOK,
            audit_events.c.action.in_([AuditAction.WEBHOOK_CALLED, AuditAction.WEBHOOK_REJECTED]),
            audit_events.c.occurred_at >= today(),
        )
        .group_by(audit_events.c.target_id)
    )
    return {row[0]: (int(row[1]), int(row[2])) for row in rows}


async def outgoing_counts(connection: AsyncConnection) -> dict[uuid.UUID, tuple[int, int]]:
    rows = await connection.execute(
        select(
            event_outbox.c.target_id,
            func.count(),
            func.count().filter(event_attempts.c.outcome != AttemptOutcome.DELIVERED),
        )
        .join(event_outbox, event_outbox.c.id == event_attempts.c.event_id)
        .where(event_attempts.c.created_at >= today())
        .group_by(event_outbox.c.target_id)
    )
    return {row[0]: (int(row[1]), int(row[2])) for row in rows}


async def webhook_totals(connection: AsyncConnection) -> tuple[int, int]:
    counts = [
        *(await incoming_counts(connection)).values(),
        *(await outgoing_counts(connection)).values(),
    ]
    return sum(calls for calls, _ in counts), sum(rejected for _, rejected in counts)


async def sign_out_people(connection: AsyncConnection) -> list[uuid.UUID]:
    rows = await connection.execute(
        select(project_members.c.user_id, project_members.c.role, project_members.c.sign_out)
        .join(projects, projects.c.id == project_members.c.project_id)
        .where(projects.c.deleted_at.is_(None), projects.c.privacy_mode == PrivacyMode.CLINICAL)
    )
    able = {
        row.user_id
        for row in rows
        if sign_out_right(PrivacyMode.CLINICAL, ProjectRole(row.role), row.sign_out)
        not in (None, "never")
    }
    return sorted(able)


async def model_count(connection: AsyncConnection) -> int:
    hidden = await hidden_names(connection)
    shown = sum(1 for model in CATALOGUE if model.name not in hidden)
    labbed = await connection.scalar(select(func.count()).select_from(lab_models))
    return shown + int(labbed or 0)


@router.get("/overview", operation_id="getAdminOverview", **require(Permission.WORKSPACE_SETTINGS))
async def get_admin_overview(connection: TenantConnection) -> AdminOverview:
    seats = (
        await connection.execute(
            select(
                func.count(),
                func.count().filter(memberships.c.role == Role.RESEARCHER),
                func.count().filter(memberships.c.role == Role.REVIEWER),
                func.count().filter(memberships.c.admin_rights),
            ).where(memberships.c.tenant_id == IN_THIS_TENANT)
        )
    ).one()
    live_projects = await connection.scalar(
        select(func.count()).where(
            projects.c.tenant_id == IN_THIS_TENANT,
            projects.c.deleted_at.is_(None),
            projects.c.archived_at.is_(None),
        )
    )
    waiting = await connection.scalar(
        select(func.count()).where(
            invitations.c.tenant_id == IN_THIS_TENANT,
            invitations.c.accepted_at.is_(None),
            invitations.c.revoked_at.is_(None),
            invitations.c.expires_at > func.now(),
        )
    )
    copied, in_place = await slide_bytes(connection)
    calls, rejected = await webhook_totals(connection)
    return AdminOverview(
        people=seats[0],
        researchers=seats[1],
        reviewers=seats[2],
        with_admin_rights=seats[3],
        can_sign_out_user_ids=await sign_out_people(connection),
        projects=int(live_projects or 0),
        invites_waiting=int(waiting or 0),
        models=await model_count(connection),
        runs_now=len(await running_now(connection)),
        stored_tb=terabytes(copied),
        capacity_tb=None,
        in_place_tb=terabytes(in_place),
        webhook_calls_today=calls,
        webhook_rejected_today=rejected,
    )


@router.get("/storage", operation_id="getStorageUsage", **require(Permission.INTEGRATIONS))
async def get_storage_usage(connection: TenantConnection) -> StorageUsage:
    copied, in_place = await slide_bytes(connection)
    size = bytes_where(COPIED)
    rows = await connection.execute(
        select(
            projects.c.id,
            projects.c.number,
            projects.c.name,
            projects.c.colour,
            size.label("size"),
        )
        .outerjoin(slides, (slides.c.project_id == projects.c.id) & LIVE_SLIDES)
        .where(projects.c.deleted_at.is_(None))
        .group_by(projects.c.id)
        .order_by(size.desc(), projects.c.number)
    )
    return StorageUsage(
        total_tb=terabytes(copied),
        total_bytes=copied,
        capacity_tb=None,
        in_place_tb=terabytes(in_place),
        in_place_bytes=in_place,
        parts=[
            StoragePart(
                kind="copied-slides", label="Copied slides", tb=terabytes(copied), bytes=copied
            )
        ],
        by_project=[
            ProjectStorage(
                project=StorageProjectRef(id=row.id, code=code_of(row.number), name=row.name),
                colour=max(0, row.colour),
                gb=round(int(row.size) / GIGABYTE, 1),
                bytes=int(row.size),
                cap_gb=None,
            )
            for row in rows
        ],
        rules=[READ_ONLY_RULE],
        sources=await storage_sources(connection),
    )


def source_health(
    slides_in_place: int, worst_failures: int
) -> Literal["answering", "unreachable", "unused"]:
    if slides_in_place == 0:
        return "unused"
    return "unreachable" if worst_failures >= OFFLINE_AFTER_FAILURES else "answering"


async def storage_sources(connection: AsyncConnection) -> list[StorageSource]:
    reads = (
        select(
            slides.c.source_id,
            func.count().label("in_place"),
            func.max(slides.c.remote_failures).label("failures"),
            func.max(slides.c.remote_read_at).label("read_at"),
        )
        .where(LIVE_SLIDES, IN_PLACE)
        .group_by(slides.c.source_id)
        .subquery()
    )
    rows = await connection.execute(
        select(import_sources, reads.c.in_place, reads.c.failures, reads.c.read_at)
        .outerjoin(reads, reads.c.source_id == import_sources.c.id)
        .order_by(import_sources.c.created_at, import_sources.c.id)
    )
    return [
        StorageSource(
            id=row.id,
            name=row.name,
            kind="https" if row.kind == "https" else "s3",
            access="Read-only key" if row.credential_ciphertext is not None else "No key",
            address=row.address,
            new_slides="in-place" if row.in_place else "copied",
            health=source_health(int(row.in_place or 0), int(row.failures or 0)),
            first_tile_ms=None,
            expires_in_days=None,
            slides_in_place=int(row.in_place or 0),
            last_read_at=row.read_at,
        )
        for row in rows
    ]


@router.get(
    "/security", operation_id="getSecuritySettings", **require(Permission.WORKSPACE_SETTINGS)
)
async def get_security_settings(request: Request, connection: TenantConnection) -> SecuritySettings:
    domains = await connection.scalar(
        select(sso_connections.c.email_domains)
        .where(sso_connections.c.tenant_id == IN_THIS_TENANT)
        .limit(1)
    )
    connected = domains is not None
    password = auth_state(request).login is not None
    return SecuritySettings(
        sign_in=[
            SecuritySetting(
                key="sso",
                label="Single sign-on",
                detail=(
                    f"Connected · {', '.join(domains)}"
                    if connected and domains
                    else "Connected"
                    if connected
                    else "Not connected"
                ),
                on=connected,
                locked=True,
            ),
            SecuritySetting(
                key="password",
                label="Email and password",
                detail="Through the hosted sign-in"
                if password
                else "Not offered on this deployment",
                on=password,
                locked=True,
            ),
        ],
        two_factor=None,
    )


def host_of(address: str) -> str:
    return urlsplit(address).hostname or address


@router.get("/webhooks", operation_id="listWebhooks", **require(Permission.INTEGRATIONS))
async def list_webhooks(connection: TenantConnection) -> list[Webhook]:
    incoming = await incoming_counts(connection)
    outgoing = await outgoing_counts(connection)
    hooks = await connection.execute(
        select(
            project_webhooks.c.id,
            projects.c.id.label("project_id"),
            projects.c.number,
            projects.c.name,
        )
        .join(projects, projects.c.id == project_webhooks.c.project_id)
        .where(projects.c.deleted_at.is_(None))
        .order_by(projects.c.number)
    )
    targets = await connection.execute(
        select(
            event_targets.c.id,
            event_targets.c.address,
            event_targets.c.events,
            event_targets.c.paused_at,
            projects.c.id.label("project_id"),
            projects.c.number,
            projects.c.name,
        )
        .join(projects, projects.c.id == event_targets.c.project_id)
        .where(projects.c.deleted_at.is_(None))
        .order_by(projects.c.number, event_targets.c.created_at, event_targets.c.id)
    )
    return [
        *(
            Webhook(
                id=hook.id,
                name=f"Into {hook.name}",
                direction="incoming",
                events=list(INCOMING_EVENTS),
                calls_today=incoming.get(hook.id, (0, 0))[0],
                rejected_today=incoming.get(hook.id, (0, 0))[1],
                project=StorageProjectRef(
                    id=hook.project_id, code=code_of(hook.number), name=hook.name
                ),
            )
            for hook in hooks
        ),
        *(
            Webhook(
                id=target.id,
                name=host_of(str(target.address)),
                direction="outgoing",
                events=sorted(target.events),
                calls_today=outgoing.get(target.id, (0, 0))[0],
                rejected_today=outgoing.get(target.id, (0, 0))[1],
                project=StorageProjectRef(
                    id=target.project_id, code=code_of(target.number), name=target.name
                ),
                address=target.address,
                paused=target.paused_at is not None,
            )
            for target in targets
        ),
    ]
