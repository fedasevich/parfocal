import uuid
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.auth import auth_state
from parfocal_api.context import TenantConnection
from parfocal_api.hidden_models import hidden_names
from parfocal_api.model_area import running_now
from parfocal_api.model_catalogue import CATALOGUE
from parfocal_api.permissions import Permission, require, sign_out_right
from parfocal_api.projects import code_of
from parfocal_api.tables import (
    PrivacyMode,
    ProjectRole,
    Role,
    import_sources,
    invitations,
    lab_models,
    memberships,
    project_members,
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


class StorageProjectRef(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class ProjectStorage(BaseModel):
    project: StorageProjectRef
    colour: int = Field(ge=0)
    gb: float = Field(ge=0)
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
    health: Literal["answering", "expiring"]
    first_tile_ms: int | None = Field(ge=0)
    expires_in_days: int | None = Field(ge=0)


class StorageUsage(BaseModel):
    total_tb: float = Field(ge=0)
    in_place_tb: float = Field(ge=0)
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


router = APIRouter(prefix="/api/tenant", tags=["tenant"])

IN_THIS_TENANT = literal_column(CURRENT_TENANT)
READ_ONLY_RULE = StorageRule(
    key="read-only-keys",
    label="Read-only keys only",
    detail="Parfocal never writes to a source",
    on=True,
    locked=True,
)


def terabytes(size: int) -> float:
    return round(size / TERABYTE, 3)


async def stored_bytes(connection: AsyncConnection) -> int:
    total = await connection.scalar(
        select(func.coalesce(func.sum(slides.c.file_bytes), 0)).where(slides.c.deleted_at.is_(None))
    )
    return int(total or 0)


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
        stored_tb=terabytes(await stored_bytes(connection)),
        capacity_tb=None,
        in_place_tb=0,
        webhook_calls_today=0,
        webhook_rejected_today=0,
    )


@router.get("/storage", operation_id="getStorageUsage", **require(Permission.INTEGRATIONS))
async def get_storage_usage(connection: TenantConnection) -> StorageUsage:
    stored = await stored_bytes(connection)
    rows = await connection.execute(
        select(
            projects.c.id,
            projects.c.number,
            projects.c.name,
            projects.c.colour,
            func.coalesce(func.sum(slides.c.file_bytes), 0).label("size"),
        )
        .outerjoin(slides, (slides.c.project_id == projects.c.id) & slides.c.deleted_at.is_(None))
        .where(projects.c.deleted_at.is_(None))
        .group_by(projects.c.id)
        .order_by(func.coalesce(func.sum(slides.c.file_bytes), 0).desc(), projects.c.number)
    )
    sources = await connection.execute(
        select(import_sources).order_by(import_sources.c.created_at, import_sources.c.id)
    )
    return StorageUsage(
        total_tb=terabytes(stored),
        in_place_tb=0,
        parts=[StoragePart(kind="copied-slides", label="Copied slides", tb=terabytes(stored))],
        by_project=[
            ProjectStorage(
                project=StorageProjectRef(id=row.id, code=code_of(row.number), name=row.name),
                colour=max(0, row.colour),
                gb=round(int(row.size) / GIGABYTE, 1),
                cap_gb=None,
            )
            for row in rows
        ],
        rules=[READ_ONLY_RULE],
        sources=[
            StorageSource(
                id=source.id,
                name=source.name,
                kind="https" if source.kind == "https" else "s3",
                access="Read-only key" if source.credential_ciphertext is not None else "No key",
                address=source.address,
                new_slides="copied",
                health="answering",
                first_tile_ms=None,
                expires_in_days=None,
            )
            for source in sources
        ],
    )


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


@router.get("/webhooks", operation_id="listWebhooks", **require(Permission.INTEGRATIONS))
async def list_webhooks() -> list[Webhook]:
    return []
