import json
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Annotated, Any

import httpx2
from fastapi import APIRouter, Path, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy import delete, insert, select, update
from sqlalchemy.engine import Row
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import user_of
from parfocal_api.cases import keyring_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.identifiers import ensure_keys, load_keys, open_field, seal_field
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal, database_scope
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.tables import ImportSourceKind, import_sources, slides
from parfocal_api.uploads import Settings
from parfocal_common.envelope import MasterKeyring
from parfocal_common.link_fetch import (
    LINK_FAILURES,
    LinkRefusal,
    LinkRefusedError,
    policy_of,
    target_of,
)
from parfocal_common.link_listing import LinkedFile
from parfocal_common.object_store import MAX_PRESIGN_SECONDS, StorageLocation, presign

TABLE = "import_sources"
CREDENTIAL_FIELD = "credential"
LIST_SECONDS = 300
FETCH_GRACE_SECONDS = 6 * 3600

type SourceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
type Address = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2048)
]
type Region = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[a-z0-9-]{1,40}$")]
type HeaderName = Annotated[
    str,
    StringConstraints(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9-]*$"),
]
type KeyId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)]
type Secret = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=8, max_length=4096)
]
type SourceId = Annotated[uuid.UUID, Path()]

router = APIRouter(prefix="/api/tenant/import-sources", tags=["tenant"])


class ImportSourceInvalidError(BadRequestError):
    code = "import-source-invalid"
    title = "This source cannot be saved"


class ImportSourceExistsError(ConflictError):
    code = "import-source-exists"
    title = "A source with this name is already saved"


class ImportSourceNotFoundError(NotFoundError):
    code = "import-source-not-found"
    title = "No saved source has this ID"


class ImportSourceDraft(BaseModel):
    name: SourceName
    kind: ImportSourceKind
    address: Address
    region: Region | None = None
    header_name: HeaderName | None = None
    key_id: KeyId | None = None
    secret: Secret | None = None


class ImportSource(BaseModel):
    id: uuid.UUID
    name: str
    kind: ImportSourceKind
    address: str
    host: str
    region: str | None
    header_name: str | None
    has_credential: bool
    created_at: datetime
    updated_at: datetime


class ImportSources(BaseModel):
    sources: list[ImportSource]


@dataclass(frozen=True)
class Credential:
    secret: str
    key_id: str | None = None


@dataclass(frozen=True)
class Reach:
    address: str
    listing: str
    headers: Mapping[str, str] = field(default_factory=dict[str, str])
    location: StorageLocation | None = None
    source_id: uuid.UUID | None = None
    fetch_seconds: int = MAX_PRESIGN_SECONDS

    def signed(self, file: LinkedFile, now: datetime) -> LinkedFile:
        if self.location is None:
            return file
        key = httpx2.URL(file.url).path.removeprefix(f"/{self.location.bucket}/")
        return replace(file, url=presign(self.location, "GET", key, {}, self.fetch_seconds, now))

    def fetch_note(self, file: LinkedFile) -> dict[str, str]:
        if self.headers and self.source_id is not None:
            return {"address": file.url, "source_id": str(self.source_id)}
        return {"address": file.url}


def invalid(reason: str) -> ImportSourceInvalidError:
    return ImportSourceInvalidError(reason)


def host_of(address: str) -> str:
    return httpx2.URL(address).netloc.decode("ascii")


def parsed(address: str) -> httpx2.URL:
    try:
        url = httpx2.URL(address)
    except httpx2.InvalidURL as error:
        raise invalid(LINK_FAILURES[LinkRefusal.SCHEME]) from error
    if url.userinfo:
        raise invalid(LINK_FAILURES[LinkRefusal.CREDENTIALS])
    return url


def bucket_and_prefix(url: httpx2.URL) -> tuple[str, str]:
    bucket, _, prefix = url.path.lstrip("/").partition("/")
    return bucket, prefix


async def check_draft(settings: Settings, draft: ImportSourceDraft, stored: bool) -> None:
    url = parsed(draft.address)
    try:
        await target_of(url, policy_of(settings.link_trusted_origins))
    except LinkRefusedError as error:
        raise invalid(LINK_FAILURES[error.code]) from error
    has_secret = draft.secret is not None or stored
    match draft.kind:
        case ImportSourceKind.HTTPS:
            if draft.region is not None or draft.key_id is not None:
                raise invalid("An HTTPS source takes a header, not a storage key.")
            if (draft.header_name is None) != (not has_secret):
                raise invalid("Give both the header name and its value, or neither.")
        case ImportSourceKind.STORAGE:
            if draft.header_name is not None:
                raise invalid("An object storage source signs its requests and takes no header.")
            if draft.region is None:
                raise invalid("Give the storage region, such as eu-central-1 or auto.")
            if url.query or not bucket_and_prefix(url)[0]:
                raise invalid("Give the endpoint and the bucket, such as https://host/bucket/.")
            if (draft.key_id is None) != (draft.secret is None) or not has_secret:
                raise invalid("Give both the access key ID and the secret access key.")


def sealed_credential(draft: ImportSourceDraft) -> str | None:
    if draft.secret is None:
        return None
    return json.dumps({"secret": draft.secret, "key_id": draft.key_id})


def credential_of(keys: Any, row: Row[Any]) -> Credential | None:
    opened = open_field(keys, TABLE, row.id, CREDENTIAL_FIELD, row.credential_ciphertext)
    if opened is None:
        return None
    value = json.loads(opened)
    return Credential(value["secret"], value.get("key_id"))


def source_of(row: Row[Any]) -> ImportSource:
    return ImportSource(
        id=row.id,
        name=row.name,
        kind=ImportSourceKind(row.kind),
        address=row.address,
        host=host_of(row.address),
        region=row.region,
        header_name=row.header_name,
        has_credential=row.credential_ciphertext is not None,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def source_row(connection: AsyncConnection, source_id: uuid.UUID) -> Row[Any]:
    row = (
        await connection.execute(select(import_sources).where(import_sources.c.id == source_id))
    ).first()
    if row is None:
        raise ImportSourceNotFoundError
    return row


async def audited(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    source_id: uuid.UUID,
    draft: ImportSourceDraft,
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.IMPORT_SOURCE,
        source_id,
        tenant_id=database_scope(principal).tenant_id,
        details={"name": draft.name, "kind": draft.kind, "host": host_of(draft.address)},
    )


def location_of(row: Row[Any], credential: Credential) -> StorageLocation:
    url = httpx2.URL(row.address)
    bucket, _ = bucket_and_prefix(url)
    return StorageLocation(
        endpoint=str(url.copy_with(path="/", query=None, fragment=None)).rstrip("/"),
        region=row.region,
        bucket=bucket,
        access_key_id=credential.key_id or "",
        secret_access_key=credential.secret,
    )


def reach_of(
    row: Row[Any], credential: Credential | None, fetch_seconds: float, now: datetime
) -> Reach:
    if row.kind == ImportSourceKind.HTTPS:
        headers = {row.header_name: credential.secret} if credential and row.header_name else {}
        return Reach(row.address, row.address, headers, source_id=row.id)
    if credential is None:
        raise LinkRefusedError(LinkRefusal.STATUS)
    location = location_of(row, credential)
    _, prefix = bucket_and_prefix(httpx2.URL(row.address))
    listing = presign(
        location,
        "GET",
        "",
        {"list-type": "2", "prefix": prefix, "delimiter": "/"},
        LIST_SECONDS,
        now,
    )
    seconds = min(MAX_PRESIGN_SECONDS, int(fetch_seconds) + FETCH_GRACE_SECONDS)
    return Reach(row.address, listing, location=location, source_id=row.id, fetch_seconds=seconds)


async def saved_reach(
    connection: AsyncConnection,
    keyring: MasterKeyring,
    tenant_id: uuid.UUID,
    source_id: uuid.UUID,
    fetch_seconds: float,
) -> Reach:
    row = await source_row(connection, source_id)
    credential = None
    if row.credential_ciphertext is not None:
        credential = credential_of(await load_keys(connection, keyring, tenant_id), row)
    return reach_of(row, credential, fetch_seconds, datetime.now(UTC))


async def fetch_headers(
    connection: AsyncConnection,
    keyring: MasterKeyring | None,
    tenant_id: uuid.UUID,
    source_id: uuid.UUID,
) -> dict[str, str]:
    if keyring is None:
        raise LinkRefusedError(LinkRefusal.STATUS)
    row = (
        await connection.execute(select(import_sources).where(import_sources.c.id == source_id))
    ).first()
    if row is None or row.kind != ImportSourceKind.HTTPS or row.credential_ciphertext is None:
        raise LinkRefusedError(LinkRefusal.STATUS)
    credential = credential_of(await load_keys(connection, keyring, tenant_id), row)
    if credential is None or row.header_name is None:
        raise LinkRefusedError(LinkRefusal.STATUS)
    return {row.header_name: credential.secret}


@router.get("", operation_id="listImportSources", **require(Permission.INTEGRATIONS))
async def list_import_sources(connection: TenantConnection) -> ImportSources:
    rows = (await connection.execute(select(import_sources).order_by(import_sources.c.name))).all()
    return ImportSources(sources=[source_of(row) for row in rows])


@router.post(
    "",
    operation_id="saveImportSource",
    status_code=201,
    **require(Permission.INTEGRATIONS, write=True),
)
async def save_import_source(
    draft: ImportSourceDraft,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
) -> ImportSource:
    await check_draft(settings, draft, stored=False)
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    source_id = uuid.uuid4()
    credential = sealed_credential(draft)
    sealed = None
    if credential is not None:
        keys = await ensure_keys(connection, keyring_of(request), tenant_id)
        sealed = seal_field(keys, TABLE, source_id, CREDENTIAL_FIELD, credential)
    try:
        async with connection.begin_nested():
            await connection.execute(
                insert(import_sources).values(
                    id=source_id,
                    tenant_id=tenant_id,
                    name=draft.name,
                    kind=draft.kind,
                    address=draft.address,
                    region=draft.region,
                    header_name=draft.header_name,
                    credential_ciphertext=sealed,
                    created_by_user_id=user_of(principal),
                )
            )
    except IntegrityError as error:
        raise ImportSourceExistsError from error
    await audited(connection, principal, AuditAction.IMPORT_SOURCE_SAVED, source_id, draft)
    return source_of(await source_row(connection, source_id))


@router.put(
    "/{source_id}",
    operation_id="changeImportSource",
    **require(Permission.INTEGRATIONS, write=True),
)
async def change_import_source(
    source_id: SourceId,
    draft: ImportSourceDraft,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
) -> ImportSource:
    row = await source_row(connection, source_id)
    if draft.kind != row.kind:
        raise invalid("A saved source keeps its type. Save a new source instead.")
    keeps = draft.secret is None and row.credential_ciphertext is not None
    if draft.kind is ImportSourceKind.HTTPS and draft.header_name is None:
        keeps = False
    await check_draft(settings, draft, stored=keeps)
    values: dict[str, Any] = {
        "name": draft.name,
        "address": draft.address,
        "region": draft.region,
        "header_name": draft.header_name,
    }
    credential = sealed_credential(draft)
    if credential is not None:
        tenant_id = database_scope(principal).tenant_id
        assert tenant_id is not None
        keys = await ensure_keys(connection, keyring_of(request), tenant_id)
        values["credential_ciphertext"] = seal_field(
            keys, TABLE, source_id, CREDENTIAL_FIELD, credential
        )
    elif not keeps:
        values["credential_ciphertext"] = None
    try:
        async with connection.begin_nested():
            await connection.execute(
                update(import_sources).where(import_sources.c.id == source_id).values(**values)
            )
    except IntegrityError as error:
        raise ImportSourceExistsError from error
    await audited(connection, principal, AuditAction.IMPORT_SOURCE_CHANGED, source_id, draft)
    return source_of(await source_row(connection, source_id))


@router.delete(
    "/{source_id}",
    operation_id="deleteImportSource",
    status_code=204,
    **require(Permission.INTEGRATIONS, write=True),
)
async def delete_import_source(
    source_id: SourceId, principal: CurrentPrincipal, connection: TenantConnection
) -> None:
    row = await source_row(connection, source_id)
    await connection.execute(
        update(slides).where(slides.c.source_id == source_id).values(source_id=None)
    )
    await connection.execute(delete(import_sources).where(import_sources.c.id == source_id))
    await record(
        connection,
        actor_of(principal),
        AuditAction.IMPORT_SOURCE_DELETED,
        AuditTarget.IMPORT_SOURCE,
        source_id,
        tenant_id=database_scope(principal).tenant_id,
        details={"name": row.name, "kind": row.kind, "host": host_of(row.address)},
    )
