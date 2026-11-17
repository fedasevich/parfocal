import logging
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Path, Request
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_api.audit import Actor, AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import user_of
from parfocal_api.cases import keyring_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.import_sources import host_of, saved_reach, source_row
from parfocal_api.link_imports import LinkNotFetchedError, Look, look, planned_files, start_file
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal, database_scope
from parfocal_api.problems import BadRequestError, NotFoundError, ProblemError
from parfocal_api.project_access import principal_of
from parfocal_api.projects import row_of
from parfocal_api.settings import ApiSettings
from parfocal_api.tables import ActorKind, import_sources, source_watches, tenants, watched_files
from parfocal_api.uploads import Settings
from parfocal_common.db import DatabaseScope, scoped_transaction
from parfocal_common.envelope import MasterKeyring
from parfocal_common.jobs import PLATFORM
from parfocal_common.link_fetch import LINK_FAILURES, LinkRefusedError
from parfocal_common.object_store import ObjectStore

SCAN_MINUTES = 60
MAX_FILES_PER_SCAN = 50
WATCH_ACTOR = Actor(ActorKind.SYSTEM)

type ProjectId = Annotated[uuid.UUID, Path()]

router = APIRouter(prefix="/api/projects", tags=["uploads"])
logger = logging.getLogger("parfocal.api.remote")


class SourceWatchDraft(BaseModel):
    source_id: uuid.UUID


class SourceWatch(BaseModel):
    project_id: uuid.UUID
    source_id: uuid.UUID
    source_name: str
    host: str
    every_minutes: int
    files_seen: int
    scanned_at: datetime | None
    created_at: datetime


class SourceWatchNotFoundError(NotFoundError):
    code = "source-watch-not-found"
    title = "This project does not watch a source"


class SourceNotListedError(BadRequestError):
    code = "source-not-listed"
    title = "Parfocal could not list this source"


async def watch_row(connection: AsyncConnection, project_id: uuid.UUID) -> Row[Any] | None:
    return (
        await connection.execute(
            select(source_watches, import_sources.c.name, import_sources.c.address)
            .join(import_sources, import_sources.c.id == source_watches.c.source_id)
            .where(source_watches.c.project_id == project_id)
        )
    ).one_or_none()


async def watch_of(connection: AsyncConnection, row: Row[Any]) -> SourceWatch:
    seen = await connection.scalar(
        select(func.count()).select_from(watched_files).where(watched_files.c.watch_id == row.id)
    )
    return SourceWatch(
        project_id=row.project_id,
        source_id=row.source_id,
        source_name=row.name,
        host=host_of(row.address),
        every_minutes=SCAN_MINUTES,
        files_seen=int(seen or 0),
        scanned_at=row.scanned_at,
        created_at=row.created_at,
    )


async def project_watch(connection: AsyncConnection, project_id: uuid.UUID) -> SourceWatch | None:
    row = await watch_row(connection, project_id)
    return await watch_of(connection, row) if row is not None else None


async def remember(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    watch_id: uuid.UUID,
    files: dict[str, uuid.UUID | None],
) -> None:
    if not files:
        return
    await connection.execute(
        upsert(watched_files)
        .values(
            [
                {"tenant_id": tenant_id, "watch_id": watch_id, "name": name, "upload_id": upload}
                for name, upload in files.items()
            ]
        )
        .on_conflict_do_nothing(index_elements=["watch_id", "name"])
    )


async def looked(
    connection: AsyncConnection,
    keyring: MasterKeyring,
    principal: Principal,
    settings: ApiSettings,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    source_id: uuid.UUID,
) -> Look:
    try:
        reach = await saved_reach(
            connection, keyring, tenant_id, source_id, settings.link_fetch_seconds
        )
    except LinkRefusedError as error:
        raise LinkNotFetchedError(LINK_FAILURES[error.code]) from error
    return await look(connection, principal, settings, project_id, reach)


async def audited(
    connection: AsyncConnection, principal: Principal, action: AuditAction, row: Row[Any]
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.SOURCE_WATCH,
        row.id,
        tenant_id=row.tenant_id,
        details={"project_id": str(row.project_id), "source_id": str(row.source_id)},
    )


@router.put(
    "/{project_id}/watch",
    operation_id="watchSource",
    **require(Permission.INTEGRATIONS, write=True),
)
async def watch_source(
    project_id: ProjectId,
    draft: SourceWatchDraft,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
) -> SourceWatch:
    await row_of(connection, project_id)
    await source_row(connection, draft.source_id)
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    try:
        found = await looked(
            connection,
            keyring_of(request),
            principal,
            settings,
            tenant_id,
            project_id,
            draft.source_id,
        )
    except LinkNotFetchedError as error:
        raise SourceNotListedError(error.detail) from error
    await connection.execute(
        delete(source_watches).where(source_watches.c.project_id == project_id)
    )
    row = (
        await connection.execute(
            source_watches.insert()
            .values(
                tenant_id=tenant_id,
                project_id=project_id,
                source_id=draft.source_id,
                created_by_user_id=user_of(principal),
            )
            .returning(source_watches)
        )
    ).one()
    await remember(connection, tenant_id, row.id, {file.name: None for file in found.files})
    await audited(connection, principal, AuditAction.SOURCE_WATCH_STARTED, row)
    watched = await project_watch(connection, project_id)
    assert watched is not None
    return watched


@router.delete(
    "/{project_id}/watch",
    operation_id="stopWatchingSource",
    status_code=204,
    **require(Permission.INTEGRATIONS, write=True),
)
async def stop_watching_source(
    project_id: ProjectId, principal: CurrentPrincipal, connection: TenantConnection
) -> None:
    await row_of(connection, project_id)
    row = (
        await connection.execute(
            delete(source_watches)
            .where(source_watches.c.project_id == project_id)
            .returning(source_watches)
        )
    ).one_or_none()
    if row is None:
        raise SourceWatchNotFoundError
    await audited(connection, principal, AuditAction.SOURCE_WATCH_STOPPED, row)


async def scan_watch(
    connection: AsyncConnection,
    keyring: MasterKeyring,
    settings: ApiSettings,
    store: ObjectStore,
    watch: Row[Any],
    now: datetime,
) -> int:
    await connection.execute(
        update(source_watches).where(source_watches.c.id == watch.id).values(scanned_at=now)
    )
    if watch.created_by_user_id is None:
        return 0
    principal = await principal_of(connection, watch.tenant_id, watch.created_by_user_id)
    if principal is None:
        return 0
    found = await looked(
        connection,
        keyring,
        principal,
        settings,
        watch.tenant_id,
        watch.project_id,
        watch.source_id,
    )
    seen = set(
        await connection.scalars(
            select(watched_files.c.name).where(watched_files.c.watch_id == watch.id)
        )
    )
    fresh = [entry.path for entry in found.draft.slides if entry.path not in seen]
    fresh = fresh[:MAX_FILES_PER_SCAN]
    planned = planned_files(found, settings, set(fresh))
    slide_uploads: dict[str, uuid.UUID] = {}
    started = {
        item.file.name: (
            await start_file(
                connection,
                WATCH_ACTOR,
                {"created_by_user_id": watch.created_by_user_id},
                settings,
                store,
                watch.tenant_id,
                watch.project_id,
                item,
                slide_uploads,
                found.reach,
            )
        ).upload_id
        for item in planned
    }
    await remember(
        connection,
        watch.tenant_id,
        watch.id,
        {name: started.get(name) for name in [*fresh, *started]},
    )
    return len(started)


async def scan_workspace(
    engine: AsyncEngine,
    keyring: MasterKeyring,
    settings: ApiSettings,
    store: ObjectStore,
    tenant_id: uuid.UUID,
    now: datetime,
) -> int:
    scope = DatabaseScope(tenant_id=tenant_id)
    async with scoped_transaction(engine, scope) as connection:
        watches = (await connection.execute(select(source_watches))).all()
    started = 0
    for watch in watches:
        try:
            async with scoped_transaction(engine, scope) as connection:
                started += await scan_watch(connection, keyring, settings, store, watch, now)
        except ProblemError as error:
            logger.warning("watched source not scanned", extra={"code": error.code})
        except Exception as error:
            logger.warning("watched source failed", extra={"error": type(error).__name__})
    return started


async def scan_every_workspace(
    engine: AsyncEngine,
    keyring: MasterKeyring,
    settings: ApiSettings,
    store: ObjectStore,
    now: datetime | None = None,
) -> int:
    moment = now or datetime.now(UTC)
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant_ids: Sequence[uuid.UUID] = (
            await connection.scalars(select(tenants.c.id).order_by(tenants.c.id))
        ).all()
    started = 0
    for tenant_id in tenant_ids:
        started += await scan_workspace(engine, keyring, settings, store, tenant_id, moment)
    if started:
        logger.info("watched sources scanned", extra={"count": started})
    return started
