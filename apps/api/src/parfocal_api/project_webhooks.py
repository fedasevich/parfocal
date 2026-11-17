import hashlib
import hmac
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Annotated, Any, Literal

import httpx2
from fastapi import APIRouter, Header, Path, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import Actor, AuditAction, AuditTarget, actor_of, record
from parfocal_api.auth import AUTH_SCOPE, auth_state
from parfocal_api.blinding import user_of
from parfocal_api.cases import keyring_of
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection, engine_of
from parfocal_api.identifiers import ensure_keys, load_keys, open_field, seal_field
from parfocal_api.import_sources import Reach
from parfocal_api.link_imports import (
    LinkNotFetchedError,
    Planned,
    files_at,
    kind_of_file,
    refusal_of,
    start_file,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal, database_scope
from parfocal_api.problems import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    ProblemError,
    TooManyRequestsError,
    UnauthenticatedError,
)
from parfocal_api.projects import row_of
from parfocal_api.rate_limits import counted_wait
from parfocal_api.tables import (
    ActorKind,
    TenantStatus,
    cases,
    project_webhooks,
    projects,
    review_tasks,
    tenants,
    webhook_calls,
)
from parfocal_api.uploads import Settings
from parfocal_common.db import DatabaseScope, scoped_transaction
from parfocal_common.envelope import MasterKeyring
from parfocal_common.link_fetch import LINK_FAILURES
from parfocal_common.link_listing import LinkedFile
from parfocal_common.pairing import Certainty, FileKind, Rule
from parfocal_common.result_imports import UploadKind

TABLE = "project_webhooks"
SECRET_FIELD = "secret"
OLD_SECRET_FIELD = "old_secret"
SKEW_SECONDS = 300
CALLS_PER_MINUTE = 60
REPEAT_WINDOW = timedelta(hours=24)
MAX_RESULTS = 20
MAX_ADDRESS = 2048
MAX_IDEMPOTENCY_KEY = 200
WEBHOOK_PATH = "/api/webhooks"
WEBHOOK_ACTOR = Actor(ActorKind.SYSTEM)
SIGNATURE_VERSION = "v1="

type ProjectId = Annotated[uuid.UUID, Path()]
type HookKey = Annotated[str, Path(min_length=32, max_length=32, pattern=r"^[0-9a-f]{32}$")]
Address = Annotated[str, Field(min_length=1, max_length=MAX_ADDRESS)]

router = APIRouter(prefix="/api/projects", tags=["webhooks"])
public_router = APIRouter(prefix=WEBHOOK_PATH, tags=["webhooks"])


class WebhookNotFoundError(NotFoundError):
    code = "webhook-not-found"
    title = "This project has no webhook yet"


class NoOldSecretError(NotFoundError):
    code = "webhook-old-secret-not-found"
    title = "This webhook has no older secret to retire"


class WebhookRefusedError(UnauthenticatedError):
    code = "webhook-refused"
    title = "The webhook call is not signed for this project"


class WebhookCallInvalidError(BadRequestError):
    code = "webhook-call-invalid"
    title = "The webhook call cannot be read"


class WebhookProjectClosedError(NotFoundError):
    code = "webhook-project-closed"
    title = "This project no longer takes slides"


class WebhookCaseNotFoundError(NotFoundError):
    code = "webhook-case-not-found"
    title = "No case with this ID is in the project"


class WebhookOwnerGoneError(ConflictError):
    code = "webhook-owner-gone"
    title = "The person who made this webhook secret has left, so make a new secret"


class WebhookTaskNotFoundError(NotFoundError):
    code = "webhook-task-not-found"
    title = "No task with this ID is in the project"


class Check(StrEnum):
    VALID = "valid"
    MISSING = "missing"
    STALE = "stale"
    WRONG = "wrong"
    NOT_CHECKED = "not-checked"


class WebhookCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slide: Address
    results: Annotated[list[Address], Field(max_length=MAX_RESULTS)] = []
    case_id: uuid.UUID
    task_id: uuid.UUID | None = None


class LinkOutcome(BaseModel):
    link: str
    kind: UploadKind
    outcome: Literal["started", "refused"]
    upload_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None
    message: str | None = None


class TaskOutcome(BaseModel):
    id: uuid.UUID
    outcome: Literal["recorded"]


class WebhookAnswer(BaseModel):
    call_id: uuid.UUID
    project_id: uuid.UUID
    case_id: uuid.UUID
    task: TaskOutcome | None
    repeated: bool
    links: list[LinkOutcome]


class ProjectWebhook(BaseModel):
    url: str
    has_old_secret: bool
    created_at: datetime
    rotated_at: datetime | None


class NewWebhookSecret(ProjectWebhook):
    secret: str


@dataclass(frozen=True)
class Handled:
    outcome: str
    answer: WebhookAnswer | None = None
    problem: ProblemError | None = None


def signature_of(secret: str, timestamp: str, body: bytes) -> str:
    message = timestamp.encode() + b"." + body
    digest = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return f"{SIGNATURE_VERSION}{digest}"


def signature_check(
    known: list[str], timestamp: str | None, signature: str | None, body: bytes, now: float
) -> Check:
    if not timestamp or not signature or not timestamp.isdigit():
        return Check.MISSING
    if abs(now - int(timestamp)) > SKEW_SECONDS:
        return Check.STALE
    given = signature.strip().encode()
    for secret in known:
        if hmac.compare_digest(signature_of(secret, timestamp, body).encode(), given):
            return Check.VALID
    return Check.WRONG


def public_link(address: str) -> str:
    try:
        url = httpx2.URL(address)
    except httpx2.InvalidURL:
        return "unreadable link"
    return str(url.copy_with(query=None, fragment=None, userinfo=b""))


def url_of(request: Request, hook_key: str) -> str:
    return f"{auth_state(request).public_origin}{WEBHOOK_PATH}/{hook_key}"


def webhook_of(request: Request, row: Row[Any]) -> ProjectWebhook:
    return ProjectWebhook(
        url=url_of(request, row.hook_key),
        has_old_secret=row.old_secret_ciphertext is not None,
        created_at=row.created_at,
        rotated_at=row.rotated_at,
    )


def secrets_of(keys: Any, row: Row[Any]) -> list[str]:
    opened = [
        open_field(keys, TABLE, row.id, SECRET_FIELD, row.secret_ciphertext),
        open_field(keys, TABLE, row.id, OLD_SECRET_FIELD, row.old_secret_ciphertext),
    ]
    return [secret for secret in opened if secret is not None]


async def hook_row(connection: AsyncConnection, project_id: uuid.UUID) -> Row[Any] | None:
    return (
        await connection.execute(
            select(project_webhooks).where(project_webhooks.c.project_id == project_id)
        )
    ).one_or_none()


async def audited(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    row: Row[Any],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.WEBHOOK,
        row.id,
        tenant_id=row.tenant_id,
        details={"project_id": str(row.project_id)},
    )


@router.get(
    "/{project_id}/webhook",
    operation_id="getProjectWebhook",
    **require(Permission.INTEGRATIONS),
)
async def get_project_webhook(
    project_id: ProjectId, request: Request, connection: TenantConnection
) -> ProjectWebhook:
    await row_of(connection, project_id)
    row = await hook_row(connection, project_id)
    if row is None:
        raise WebhookNotFoundError
    return webhook_of(request, row)


@router.post(
    "/{project_id}/webhook/secret",
    operation_id="createWebhookSecret",
    status_code=201,
    **require(Permission.INTEGRATIONS, write=True),
)
async def create_webhook_secret(
    project_id: ProjectId,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> NewWebhookSecret:
    await row_of(connection, project_id)
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    keys = await ensure_keys(connection, keyring_of(request), tenant_id)
    secret = secrets.token_hex(32)
    row = await hook_row(connection, project_id)
    if row is None:
        hook_id = uuid.uuid4()
        await connection.execute(
            insert(project_webhooks).values(
                id=hook_id,
                tenant_id=tenant_id,
                project_id=project_id,
                hook_key=secrets.token_hex(16),
                secret_ciphertext=seal_field(keys, TABLE, hook_id, SECRET_FIELD, secret),
                created_by_user_id=user_of(principal),
            )
        )
    else:
        hook_id = row.id
        current = open_field(keys, TABLE, hook_id, SECRET_FIELD, row.secret_ciphertext)
        await connection.execute(
            update(project_webhooks)
            .where(project_webhooks.c.id == hook_id)
            .values(
                secret_ciphertext=seal_field(keys, TABLE, hook_id, SECRET_FIELD, secret),
                old_secret_ciphertext=seal_field(keys, TABLE, hook_id, OLD_SECRET_FIELD, current),
                rotated_at=func.now(),
                created_by_user_id=user_of(principal),
            )
        )
    saved = await hook_row(connection, project_id)
    assert saved is not None
    await audited(connection, principal, AuditAction.WEBHOOK_SECRET_CREATED, saved)
    return NewWebhookSecret(**webhook_of(request, saved).model_dump(), secret=secret)


@router.delete(
    "/{project_id}/webhook/old-secret",
    operation_id="retireWebhookSecret",
    status_code=204,
    **require(Permission.INTEGRATIONS, write=True),
)
async def retire_webhook_secret(
    project_id: ProjectId, principal: CurrentPrincipal, connection: TenantConnection
) -> None:
    await row_of(connection, project_id)
    row = await hook_row(connection, project_id)
    if row is None:
        raise WebhookNotFoundError
    if row.old_secret_ciphertext is None:
        raise NoOldSecretError
    await connection.execute(
        update(project_webhooks)
        .where(project_webhooks.c.id == row.id)
        .values(old_secret_ciphertext=None)
    )
    await audited(connection, principal, AuditAction.WEBHOOK_SECRET_RETIRED, row)


async def one_file(settings: Any, address: str, kind: UploadKind) -> LinkedFile | str:
    try:
        found = await files_at(settings, Reach(address, address))
    except LinkNotFetchedError as error:
        return error.detail or error.title
    if len(found) != 1:
        return "Give a link to one file, not to a folder."
    file = found[0]
    if kind is UploadKind.SLIDE and kind_of_file(file.name) is not FileKind.SLIDE:
        return "This file is not a slide format Parfocal reads."
    if kind is UploadKind.RESULT and kind_of_file(file.name) is not FileKind.RESULT:
        return "This file is not a result format Parfocal reads."
    refused = refusal_of(file, settings)
    if refused is not None:
        return LINK_FAILURES[refused]
    return file


def refused_link(address: str, kind: UploadKind, message: str) -> LinkOutcome:
    return LinkOutcome(link=public_link(address), kind=kind, outcome="refused", message=message)


async def started_links(
    connection: AsyncConnection,
    settings: Any,
    store: Any,
    hook: Row[Any],
    call: WebhookCall,
) -> list[LinkOutcome]:
    slide = await one_file(settings, call.slide, UploadKind.SLIDE)
    if isinstance(slide, str):
        skipped = "The slide was not imported, so its results were not either."
        return [
            refused_link(call.slide, UploadKind.SLIDE, slide),
            *(refused_link(link, UploadKind.RESULT, skipped) for link in call.results),
        ]
    slide_uploads: dict[str, uuid.UUID] = {}
    planned: list[tuple[str, Planned]] = [
        (call.slide, Planned(slide, UploadKind.SLIDE, call.case_id))
    ]
    outcomes: dict[str, LinkOutcome] = {}
    for link in call.results:
        result = await one_file(settings, link, UploadKind.RESULT)
        if isinstance(result, str):
            outcomes[link] = refused_link(link, UploadKind.RESULT, result)
            continue
        planned.append(
            (
                link,
                Planned(
                    result,
                    UploadKind.RESULT,
                    call.case_id,
                    slide.name,
                    Certainty.SURE,
                    Rule.PICKED,
                ),
            )
        )
    for link, item in planned:
        started = await start_file(
            connection,
            WEBHOOK_ACTOR,
            {"created_by_user_id": hook.created_by_user_id},
            settings,
            store,
            hook.tenant_id,
            hook.project_id,
            item,
            slide_uploads,
            Reach(link, link),
        )
        outcomes[link] = LinkOutcome(
            link=public_link(link),
            kind=item.kind,
            outcome="started",
            upload_id=started.upload_id,
            job_id=started.job_id,
        )
    return [outcomes[link] for link in (call.slide, *call.results)]


async def repeated_answer(
    connection: AsyncConnection, hook_id: uuid.UUID, key: str
) -> WebhookAnswer | None:
    older = func.now() - REPEAT_WINDOW
    same = (webhook_calls.c.webhook_id == hook_id) & (webhook_calls.c.idempotency_key == key)
    await connection.execute(delete(webhook_calls).where(same, webhook_calls.c.created_at < older))
    stored = await connection.scalar(select(webhook_calls.c.answer).where(same))
    if stored is None:
        return None
    return WebhookAnswer.model_validate(stored).model_copy(update={"repeated": True})


async def in_project(
    connection: AsyncConnection, table: Any, row_id: uuid.UUID, project_id: uuid.UUID
) -> bool:
    found = await connection.scalar(
        select(table.c.id).where(table.c.id == row_id, table.c.project_id == project_id)
    )
    return found is not None


async def handled(
    connection: AsyncConnection,
    settings: Any,
    store: Any,
    hook: Row[Any],
    body: bytes,
    key: str | None,
) -> Handled:
    if key is not None and not 0 < len(key) <= MAX_IDEMPOTENCY_KEY:
        return Handled(
            "invalid", problem=WebhookCallInvalidError("The Idempotency-Key is too long.")
        )
    try:
        call = WebhookCall.model_validate_json(body)
    except ValidationError:
        return Handled("invalid", problem=WebhookCallInvalidError())
    if key is not None:
        repeated = await repeated_answer(connection, hook.id, key)
        if repeated is not None:
            return Handled("repeated", answer=repeated)
    deleted = await connection.scalar(
        select(projects.c.deleted_at).where(projects.c.id == hook.project_id)
    )
    if deleted is not None:
        return Handled("project-closed", problem=WebhookProjectClosedError())
    if not await in_project(connection, cases, call.case_id, hook.project_id):
        return Handled("case-not-found", problem=WebhookCaseNotFoundError())
    if hook.created_by_user_id is None:
        return Handled("owner-gone", problem=WebhookOwnerGoneError())
    if call.task_id is not None and not await in_project(
        connection, review_tasks, call.task_id, hook.project_id
    ):
        return Handled("task-not-found", problem=WebhookTaskNotFoundError())
    links = await started_links(connection, settings, store, hook, call)
    answer = WebhookAnswer(
        call_id=uuid.uuid4(),
        project_id=hook.project_id,
        case_id=call.case_id,
        task=TaskOutcome(id=call.task_id, outcome="recorded") if call.task_id else None,
        repeated=False,
        links=links,
    )
    await connection.execute(
        insert(webhook_calls).values(
            id=answer.call_id,
            tenant_id=hook.tenant_id,
            webhook_id=hook.id,
            idempotency_key=key,
            answer=answer.model_dump(mode="json"),
        )
    )
    return Handled("accepted", answer=answer)


def counted(answer: WebhookAnswer | None, outcome: str) -> dict[str, int]:
    links = answer.links if answer is not None else []
    return {
        "started": sum(link.outcome == "started" for link in links) if outcome == "accepted" else 0,
        "refused": sum(link.outcome == "refused" for link in links) if outcome == "accepted" else 0,
    }


async def answered(
    connection: AsyncConnection,
    keyring: MasterKeyring,
    settings: Any,
    store: Any,
    hook_id: uuid.UUID,
    tenant_id: uuid.UUID,
    signed: tuple[str | None, str | None, bytes],
    key: str | None,
) -> Handled:
    hook = (
        await connection.execute(select(project_webhooks).where(project_webhooks.c.id == hook_id))
    ).one()
    status = await connection.scalar(select(tenants.c.status).where(tenants.c.id == tenant_id))
    timestamp, signature, body = signed
    if status == TenantStatus.SUSPENDED:
        check = Check.NOT_CHECKED
        result = Handled("workspace-suspended", problem=WebhookRefusedError())
    else:
        known = secrets_of(await load_keys(connection, keyring, tenant_id), hook)
        check = signature_check(known, timestamp, signature, body, time.time())
        result = (
            await handled(connection, settings, store, hook, body, key)
            if check is Check.VALID
            else Handled("refused", problem=WebhookRefusedError())
        )
    await record(
        connection,
        WEBHOOK_ACTOR,
        AuditAction.WEBHOOK_CALLED,
        AuditTarget.WEBHOOK,
        hook.id,
        tenant_id=tenant_id,
        details={
            "project_id": str(hook.project_id),
            "outcome": result.outcome,
            "signature": check,
            "idempotency_key": key is not None,
            **counted(result.answer, result.outcome),
        },
    )
    return result


@public_router.post(
    "/{hook_key}",
    operation_id="callProjectWebhook",
    status_code=202,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": WebhookCall.model_json_schema()}},
        }
    },
)
async def call_project_webhook(
    hook_key: HookKey,
    request: Request,
    settings: Settings,
    store: Store,
    timestamp: Annotated[str | None, Header(alias="Parfocal-Timestamp")] = None,
    signature: Annotated[str | None, Header(alias="Parfocal-Signature")] = None,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> WebhookAnswer:
    body = await request.body()
    engine = engine_of(request)
    async with scoped_transaction(engine, AUTH_SCOPE) as connection:
        found = (
            await connection.execute(
                select(project_webhooks.c.id, project_webhooks.c.tenant_id).where(
                    project_webhooks.c.hook_key == hook_key
                )
            )
        ).one_or_none()
        wait = (
            None
            if found is None
            else await counted_wait(connection, {f"webhook:{found.id}": CALLS_PER_MINUTE})
        )
    if found is None:
        raise WebhookRefusedError
    if wait is not None:
        raise TooManyRequestsError(wait)
    async with scoped_transaction(engine, DatabaseScope(tenant_id=found.tenant_id)) as connection:
        result = await answered(
            connection,
            keyring_of(request),
            settings,
            store,
            found.id,
            found.tenant_id,
            (timestamp, signature, body),
            idempotency_key,
        )
    if result.problem is not None:
        raise result.problem
    assert result.answer is not None
    return result.answer
