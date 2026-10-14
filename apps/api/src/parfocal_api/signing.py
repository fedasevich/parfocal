import uuid
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, literal_column, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import (
    Actor,
    AuditAction,
    AuditTarget,
    actor_of,
    pseudonym_of,
    record,
)
from parfocal_api.auth import AUTH_SCOPE, auth_state
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Grant, Permission, grant_for, require
from parfocal_api.principals import MemberPrincipal, database_scope
from parfocal_api.problems import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
)
from parfocal_api.tables import ActorKind, Role, memberships, users
from parfocal_api.users import OwnRoleError, signed_in
from parfocal_common.db import CURRENT_TENANT, scoped_transaction

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_SIGNATURE_BYTES = 100_000


class SigningMode(StrEnum):
    SIGN = "sign"
    SEND_FOR_REVIEW = "send-for-review"


class SigningRefusal(StrEnum):
    NO_SIGN_OUT_RIGHT = "no-sign-out-right"
    NO_SUPERVISOR = "no-supervisor"
    NO_SIGNATURE = "no-signature"


REFUSAL_MESSAGES = {
    SigningRefusal.NO_SIGN_OUT_RIGHT: "This role does not sign out reports",
    SigningRefusal.NO_SUPERVISOR: (
        "Reports from this person go to a supervisor first, and none is named. "
        "Ask a lead to choose one"
    ),
    SigningRefusal.NO_SIGNATURE: "Add a signature before signing out a report",
}


@dataclass(frozen=True)
class SigningDecision:
    mode: SigningMode | None
    refusal: SigningRefusal | None = None

    @property
    def message(self) -> str | None:
        return REFUSAL_MESSAGES[self.refusal] if self.refusal else None


def signs_alone_by_default(role: Role) -> bool:
    return grant_for(role, Permission.SIGN_OUT) not in {Grant.NONE, Grant.NEEDS_CO_SIGN}


def decide(
    role: Role,
    signs_alone: bool | None,
    supervisor_user_id: uuid.UUID | None,
    signature_on_file: bool,
) -> SigningDecision:
    if grant_for(role, Permission.SIGN_OUT) is Grant.NONE:
        return SigningDecision(None, SigningRefusal.NO_SIGN_OUT_RIGHT)
    alone = signs_alone_by_default(role) if signs_alone is None else signs_alone
    if not alone:
        if supervisor_user_id is None:
            return SigningDecision(None, SigningRefusal.NO_SUPERVISOR)
        return SigningDecision(SigningMode.SEND_FOR_REVIEW)
    if not signature_on_file:
        return SigningDecision(None, SigningRefusal.NO_SIGNATURE)
    return SigningDecision(SigningMode.SIGN)


class Decision(BaseModel):
    mode: SigningMode | None
    refusal: SigningRefusal | None
    message: str | None


class SigningRights(BaseModel):
    user_id: uuid.UUID
    role: Role
    signs_alone: bool
    set_by_lead: bool
    supervisor_user_id: uuid.UUID | None
    signature_on_file: bool
    decision: Decision


class SigningChange(BaseModel):
    signs_alone: bool | None
    supervisor_user_id: uuid.UUID | None


class LeadOnlyError(ForbiddenError):
    code = "lead-only"
    title = "Only a lead changes who signs alone and who supervises"


class InvalidSupervisorError(ConflictError):
    code = "invalid-supervisor"
    title = "The supervisor must be another member of this workspace who signs alone"


class InvalidSignatureError(BadRequestError):
    code = "invalid-signature"
    title = "The signature must be a PNG image of at most 100 kB"


SIGNING_COLUMNS = (
    memberships.c.user_id,
    memberships.c.role,
    memberships.c.signs_alone,
    memberships.c.supervisor_user_id,
    users.c.subject,
    (users.c.signature.is_not(None)).label("signature_on_file"),
)


async def member_signing(connection: AsyncConnection, user_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(
            select(*SIGNING_COLUMNS)
            .join(users, users.c.id == memberships.c.user_id)
            .where(
                memberships.c.user_id == user_id,
                memberships.c.tenant_id == literal_column(CURRENT_TENANT),
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Member not found")
    return row


def rights_of(row: Any) -> SigningRights:
    role = Role(row.role)
    decision = decide(role, row.signs_alone, row.supervisor_user_id, row.signature_on_file)
    return SigningRights(
        user_id=row.user_id,
        role=role,
        signs_alone=signs_alone_by_default(role) if row.signs_alone is None else row.signs_alone,
        set_by_lead=row.signs_alone is not None,
        supervisor_user_id=row.supervisor_user_id,
        signature_on_file=row.signature_on_file,
        decision=Decision(mode=decision.mode, refusal=decision.refusal, message=decision.message),
    )


tenant_router = APIRouter(prefix="/api/tenant/members", tags=["tenant"])
me_router = APIRouter(prefix="/api/me", tags=["me"])


@tenant_router.get(
    "/{user_id}/signing", operation_id="getSigningRights", **require(Permission.SEE_TEAM)
)
async def get_signing_rights(user_id: uuid.UUID, connection: TenantConnection) -> SigningRights:
    return rights_of(await member_signing(connection, user_id))


@tenant_router.put(
    "/{user_id}/signing",
    operation_id="changeSigningRights",
    **require(Permission.MANAGE_PEOPLE, write=True),
)
async def change_signing_rights(
    user_id: uuid.UUID,
    change: SigningChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> SigningRights:
    if not isinstance(principal, MemberPrincipal) or principal.role is not Role.LEAD:
        raise LeadOnlyError
    if principal.user_id == user_id:
        raise OwnRoleError
    before = await member_signing(connection, user_id)
    supervisor_subject: str | None = None
    if change.supervisor_user_id is not None:
        if change.supervisor_user_id == user_id:
            raise InvalidSupervisorError
        supervisor = await connection.execute(
            select(*SIGNING_COLUMNS)
            .join(users, users.c.id == memberships.c.user_id)
            .where(
                memberships.c.user_id == change.supervisor_user_id,
                memberships.c.tenant_id == literal_column(CURRENT_TENANT),
            )
        )
        found = supervisor.one_or_none()
        if found is None or not rights_of(found).signs_alone:
            raise InvalidSupervisorError
        supervisor_subject = found.subject
    await connection.execute(
        update(memberships)
        .where(
            memberships.c.user_id == user_id,
            memberships.c.tenant_id == literal_column(CURRENT_TENANT),
        )
        .values(signs_alone=change.signs_alone, supervisor_user_id=change.supervisor_user_id)
    )
    after = await member_signing(connection, user_id)
    previous_supervisor = None
    if before.supervisor_user_id is not None:
        subject = await connection.scalar(
            select(users.c.subject).where(users.c.id == before.supervisor_user_id)
        )
        previous_supervisor = str(await pseudonym_of(connection, str(subject)))
    await record(
        connection,
        actor_of(principal),
        AuditAction.MEMBER_SIGNING_CHANGED,
        AuditTarget.PERSON,
        person=before.subject,
        tenant_id=database_scope(principal).tenant_id,
        details={
            "signs_alone": {"from": before.signs_alone, "to": change.signs_alone},
            "supervisor": {
                "from": previous_supervisor,
                "to": str(await pseudonym_of(connection, supervisor_subject))
                if supervisor_subject
                else None,
            },
        },
    )
    return rights_of(after)


@me_router.put(
    "/signature",
    operation_id="putSignature",
    status_code=204,
    response_class=Response,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"image/png": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def put_signature(request: Request, principal: CurrentPrincipal) -> None:
    person = signed_in(principal)
    image = await request.body()
    if len(image) > MAX_SIGNATURE_BYTES or not image.startswith(PNG_MAGIC):
        raise InvalidSignatureError
    async with scoped_transaction(auth_state(request).engine, AUTH_SCOPE) as connection:
        await connection.execute(
            update(users)
            .where(users.c.id == person.user_id)
            .values(signature=image, signature_added_at=func.now())
        )
        await record(
            connection,
            Actor(ActorKind.USER, person.subject),
            AuditAction.SIGNATURE_ADDED,
            AuditTarget.PERSON,
            person=person.subject,
        )


@me_router.delete(
    "/signature", operation_id="deleteSignature", status_code=204, response_class=Response
)
async def delete_signature(request: Request, principal: CurrentPrincipal) -> None:
    person = signed_in(principal)
    async with scoped_transaction(auth_state(request).engine, AUTH_SCOPE) as connection:
        removed = await connection.scalar(
            update(users)
            .where(users.c.id == person.user_id, users.c.signature.is_not(None))
            .values(signature=None, signature_added_at=None)
            .returning(users.c.id)
        )
        if removed is not None:
            await record(
                connection,
                Actor(ActorKind.USER, person.subject),
                AuditAction.SIGNATURE_REMOVED,
                AuditTarget.PERSON,
                person=person.subject,
            )
