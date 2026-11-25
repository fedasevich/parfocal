import logging
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StringConstraints
from sqlalchemy import and_, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_api.audit import Actor, AuditAction, AuditTarget, record
from parfocal_api.auth import (
    AUTH_SCOPE,
    SESSION_COOKIE,
    USER_AGENT_LENGTH,
    auth_state,
    digest,
    now,
    session_limits,
    set_cookie,
)
from parfocal_api.context import CurrentPrincipal, TenantConnection, engine_of
from parfocal_api.permissions import Permission, member_of, require
from parfocal_api.problems import ProblemError
from parfocal_api.study_participants import (
    ParticipantCode,
    SeededParticipant,
    Seeder,
    StudySeedFailedError,
    retire_participant,
    seat_email_of,
)
from parfocal_api.study_projects import STUDY_WORKSPACE, checked_code, seat_subject
from parfocal_api.tables import ActorKind, memberships, sessions, study_links, users
from parfocal_common.db import DatabaseScope, scoped_transaction

logger = logging.getLogger("parfocal.api.study_links")

LINK_LIFETIME = timedelta(days=1)
JOIN_PATH = "/study/join"
STUDY_LINK_MARK = "study_link"

LinkToken = Annotated[str, StringConstraints(min_length=20, max_length=100)]
LinkState = Literal["waiting", "joined", "expired"]


class StudyLink(BaseModel):
    code: str
    url: str
    expires_at: datetime
    project_id: uuid.UUID
    workspace_id: uuid.UUID
    workspace_name: str


class StudyLinkRow(BaseModel):
    code: str
    created_at: datetime
    expires_at: datetime
    redeemed_at: datetime | None
    state: LinkState


class StudyLinks(BaseModel):
    links: list[StudyLinkRow]


class StudyLinkRedemption(BaseModel):
    token: LinkToken


class StudyLinkJoined(BaseModel):
    code: str


class StudyLinkGoneError(ProblemError):
    status = 410
    code = "study-link-gone"
    title = "This study link was used already or has expired, ask the moderator for a new one"


def state_of(redeemed_at: datetime | None, expires_at: datetime, at: datetime) -> LinkState:
    if redeemed_at is not None:
        return "joined"
    return "waiting" if expires_at > at else "expired"


async def issue_link(
    engine: AsyncEngine, made: SeededParticipant, moderator_id: uuid.UUID
) -> tuple[str, datetime]:
    await retire_participant(engine, made.tenant_id, made.code)
    token = secrets.token_urlsafe(32)
    async with scoped_transaction(engine, DatabaseScope(tenant_id=made.tenant_id)) as scoped:
        expires_at = await scoped.scalar(
            insert(study_links)
            .values(
                tenant_id=made.tenant_id,
                participant=made.code,
                token_hash=digest(token),
                created_by_user_id=moderator_id,
                expires_at=func.now() + LINK_LIFETIME,
            )
            .returning(study_links.c.expires_at)
        )
    assert isinstance(expires_at, datetime)
    return token, expires_at


tenant_router = APIRouter(prefix="/api/tenant", tags=["study"])
public_router = APIRouter(prefix="/api/study-links", tags=["study"])


@tenant_router.post(
    "/study-participants/{code}/link",
    operation_id="prepareStudyLink",
    **require(Permission.MANAGE_PEOPLE, write=True),
)
async def prepare_study_link(
    code: ParticipantCode,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    seeder: Seeder,
) -> StudyLink:
    member = member_of(principal)
    moderator = await seat_email_of(connection, member.user_id)
    checked = checked_code(code)
    try:
        made = await seeder.seed(checked, None, moderator)
    except ProblemError:
        raise
    except Exception as error:
        logger.exception("study seed for a link failed")
        raise StudySeedFailedError from error
    token, expires_at = await issue_link(engine_of(request), made, member.user_id)
    return StudyLink(
        code=made.code,
        url=f"{auth_state(request).public_origin}{JOIN_PATH}#{token}",
        expires_at=expires_at,
        project_id=made.project_id,
        workspace_id=made.tenant_id,
        workspace_name=STUDY_WORKSPACE.name,
    )


@tenant_router.get(
    "/study-links", operation_id="listStudyLinks", **require(Permission.MANAGE_PEOPLE)
)
async def list_study_links(connection: TenantConnection) -> StudyLinks:
    rows = await connection.execute(
        select(
            study_links.c.participant,
            study_links.c.created_at,
            study_links.c.expires_at,
            study_links.c.redeemed_at,
        ).order_by(study_links.c.created_at.desc())
    )
    at = now()
    return StudyLinks(
        links=[
            StudyLinkRow(
                code=row.participant,
                created_at=row.created_at,
                expires_at=row.expires_at,
                redeemed_at=row.redeemed_at,
                state=state_of(row.redeemed_at, row.expires_at, at),
            )
            for row in rows
        ]
    )


async def consume(engine: AsyncEngine, hashed: bytes) -> tuple[uuid.UUID, str]:
    async with scoped_transaction(engine, AUTH_SCOPE) as connection:
        tenant_id = await connection.scalar(
            select(study_links.c.tenant_id).where(study_links.c.token_hash == hashed)
        )
    if tenant_id is None:
        raise StudyLinkGoneError
    async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
        code = await connection.scalar(
            update(study_links)
            .where(
                study_links.c.token_hash == hashed,
                study_links.c.redeemed_at.is_(None),
                study_links.c.expires_at > func.now(),
            )
            .values(redeemed_at=func.now())
            .returning(study_links.c.participant)
        )
    if code is None:
        raise StudyLinkGoneError
    return tenant_id, str(code)


@public_router.post("/redeem", operation_id="redeemStudyLink", response_model=StudyLinkJoined)
async def redeem_study_link(redemption: StudyLinkRedemption, request: Request) -> JSONResponse:
    auth = auth_state(request)
    tenant_id, code = await consume(auth.engine, digest(redemption.token))
    subject = seat_subject(code)
    session_id = secrets.token_urlsafe(32)
    async with scoped_transaction(auth.engine, AUTH_SCOPE) as connection:
        seated = await connection.scalar(
            select(users.c.id)
            .join(memberships, memberships.c.user_id == users.c.id)
            .where(
                users.c.subject == subject,
                and_(memberships.c.tenant_id == tenant_id, memberships.c.deactivated_at.is_(None)),
            )
        )
        if seated is None:
            raise StudyLinkGoneError
        limits = await session_limits(connection, tenant_id)
        ends = now() + limits.lifetime
        sealed: dict[str, object] = {
            "name": f"Participant {code}",
            "email": None,
            "amr": [],
            "auth_time": int(now().timestamp()),
            STUDY_LINK_MARK: code,
        }
        await connection.execute(
            insert(sessions).values(
                id_hash=digest(session_id),
                subject=subject,
                tokens=auth.cipher.seal(sealed),
                access_expires_at=ends,
                expires_at=ends,
                active_tenant_id=tenant_id,
                user_agent=request.headers.get("user-agent", "")[:USER_AGENT_LENGTH] or None,
            )
        )
        await record(
            connection,
            Actor(ActorKind.USER, subject),
            AuditAction.USER_SIGNED_IN,
            AuditTarget.PERSON,
            person=subject,
        )
    response = JSONResponse(
        StudyLinkJoined(code=code).model_dump(),
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )
    set_cookie(response, SESSION_COOKIE, session_id, int(limits.lifetime.total_seconds()), "strict")
    return response
