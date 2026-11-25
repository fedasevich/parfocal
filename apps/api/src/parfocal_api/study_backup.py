import argparse
import asyncio
import gzip
import hashlib
import json
import logging
import uuid
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from typing import Any

import httpx2
from pydantic import AnyHttpUrl, PostgresDsn, SecretStr, model_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from parfocal_api.tables import study_sessions, study_trace_parts, tenants
from parfocal_common.db import (
    DatabaseScope,
    create_engine,
    require_row_security,
    scoped_transaction,
)
from parfocal_common.jobs import PLATFORM
from parfocal_common.object_store import ListedObject, ObjectStore, StorageLocation
from parfocal_common.settings import (
    LOCAL_STORAGE_SECRET,
    AppEnv,
    LocalSecretInProductionError,
    ServiceSettings,
    load_settings,
)
from parfocal_common.transport import require_https, require_tls_database

STUDY_ROOT = "study/"
TRACE_FOLDER = "trace/"
GZIP_TYPE = "application/gzip"

logger = logging.getLogger("parfocal.api.study_backup")


class StudyBackupSettings(ServiceSettings):
    database_url: PostgresDsn
    study_backup_bucket: str | None = None
    study_backup_endpoint: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:9000")
    study_backup_region: str = "auto"
    study_backup_access_key_id: str = "parfocal"
    study_backup_secret_access_key: SecretStr = SecretStr(LOCAL_STORAGE_SECRET)
    study_defence_date: date | None = None

    @model_validator(mode="after")
    def backup_over_tls(self) -> StudyBackupSettings:
        if self.encrypted_transport():
            require_tls_database("DATABASE_URL", self.database_url)
            if self.study_backup_bucket:
                require_https("STUDY_BACKUP_ENDPOINT", self.study_backup_endpoint)
        return self

    @model_validator(mode="after")
    def no_local_secret_in_production(self) -> StudyBackupSettings:
        local = self.study_backup_secret_access_key.get_secret_value() == LOCAL_STORAGE_SECRET
        if self.app_env is AppEnv.PROD and self.study_backup_bucket and local:
            raise LocalSecretInProductionError("STUDY_BACKUP_SECRET_ACCESS_KEY")
        return self

    def backup_location(self) -> StorageLocation | None:
        if not self.study_backup_bucket:
            return None
        return StorageLocation(
            endpoint=str(self.study_backup_endpoint).rstrip("/"),
            region=self.study_backup_region,
            bucket=self.study_backup_bucket,
            access_key_id=self.study_backup_access_key_id,
            secret_access_key=self.study_backup_secret_access_key.get_secret_value(),
        )


class StudyBackupNotConfiguredError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("STUDY_BACKUP_BUCKET is not set, so the study backup has nowhere to go")


class DefenceDateMissingError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("STUDY_DEFENCE_DATE is not set, so the study traces are kept")


class DefenceNotPassedError(RuntimeError):
    def __init__(self, defence: date, today: date) -> None:
        super().__init__(f"The defence on {defence} has not passed on {today}")


@dataclass(frozen=True)
class BackupReport:
    written: int
    objects: int
    size: int


@dataclass(frozen=True)
class DeleteReport:
    trace_rows: int
    trace_objects: int


def session_folder(tenant_id: uuid.UUID, session_key: str) -> str:
    return f"{STUDY_ROOT}{tenant_id}/{session_key}/"


def session_object_key(tenant_id: uuid.UUID, session_key: str) -> str:
    return f"{session_folder(tenant_id, session_key)}session.json.gz"


def trace_object_key(tenant_id: uuid.UUID, session_key: str, seq: int) -> str:
    return f"{session_folder(tenant_id, session_key)}{TRACE_FOLDER}{seq:020d}.json.gz"


def is_trace_key(key: str) -> bool:
    return key.startswith(STUDY_ROOT) and f"/{TRACE_FOLDER}" in key


def session_document(row: Any) -> bytes:
    document = {
        "session_key": row.session_key,
        "participant": row.participant,
        "round": row.round,
        "dry_run": row.dry_run,
        "answers": row.answers,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }
    encoded = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    return gzip.compress(encoded, mtime=0)


def unchanged(stored: ListedObject | None, body: bytes) -> bool:
    return (
        stored is not None and stored.etag == hashlib.md5(body, usedforsecurity=False).hexdigest()
    )


def defence_passed(defence: date | None, today: date) -> bool:
    return defence is not None and today > defence


async def tenant_ids(engine: AsyncEngine) -> list[uuid.UUID]:
    async with scoped_transaction(engine, PLATFORM) as connection:
        return list(await connection.scalars(select(tenants.c.id).order_by(tenants.c.id)))


async def backup_workspace(
    connection: AsyncConnection,
    store: ObjectStore,
    tenant_id: uuid.UUID,
    stored: dict[str, ListedObject],
) -> int:
    written = 0
    for row in await connection.execute(select(study_sessions)):
        key = session_object_key(tenant_id, row.session_key)
        body = session_document(row)
        if not unchanged(stored.get(key), body):
            await store.put_object(key, body, GZIP_TYPE)
            written += 1
    parts = await connection.execute(
        select(study_trace_parts.c.session_key, study_trace_parts.c.seq).order_by(
            study_trace_parts.c.session_key, study_trace_parts.c.seq
        )
    )
    for session_key, seq in list(parts):
        key = trace_object_key(tenant_id, session_key, seq)
        if key in stored:
            continue
        body = await connection.scalar(
            select(study_trace_parts.c.body).where(
                study_trace_parts.c.session_key == session_key, study_trace_parts.c.seq == seq
            )
        )
        if body is not None:
            await store.put_object(key, body, GZIP_TYPE)
            written += 1
    return written


async def stored_objects(store: ObjectStore) -> dict[str, ListedObject]:
    return {listed.key: listed for listed in await store.list_objects(STUDY_ROOT)}


def report_of(written: int, stored: dict[str, ListedObject]) -> BackupReport:
    return BackupReport(
        written=written,
        objects=len(stored),
        size=sum(listed.size for listed in stored.values()),
    )


async def backup_every_workspace(
    engine: AsyncEngine, store: ObjectStore, defence: date | None, today: date
) -> BackupReport:
    if defence_passed(defence, today):
        return report_of(0, await stored_objects(store))
    stored = await stored_objects(store)
    written = 0
    for tenant_id in await tenant_ids(engine):
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            written += await backup_workspace(connection, store, tenant_id, stored)
    report = report_of(written, await stored_objects(store) if written else stored)
    if written:
        logger.info(
            "study sessions backed up",
            extra={"count": report.written, "size_bytes": report.size},
        )
    return report


async def delete_after_defence(
    engine: AsyncEngine, store: ObjectStore, defence: date | None, today: date
) -> DeleteReport:
    if defence is None:
        raise DefenceDateMissingError
    if not defence_passed(defence, today):
        raise DefenceNotPassedError(defence, today)
    trace_rows = 0
    for tenant_id in await tenant_ids(engine):
        async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
            removed = await connection.execute(delete(study_trace_parts))
            trace_rows += removed.rowcount
    trace_keys = [key for key in await stored_objects(store) if is_trace_key(key)]
    for key in trace_keys:
        await store.delete_object(key)
    logger.info(
        "study traces deleted after the defence",
        extra={"count": trace_rows + len(trace_keys)},
    )
    return DeleteReport(trace_rows=trace_rows, trace_objects=len(trace_keys))


async def run(settings: StudyBackupSettings, action: str, today: date) -> dict[str, int]:
    location = settings.backup_location()
    if location is None:
        if action == "backup":
            return asdict(BackupReport(written=0, objects=0, size=0))
        raise StudyBackupNotConfiguredError
    engine = create_engine(str(settings.database_url))
    try:
        await require_row_security(engine)
        async with httpx2.AsyncClient(timeout=60) as http:
            store = ObjectStore(location, http)
            if action == "size":
                return asdict(report_of(0, await stored_objects(store)))
            if action == "delete":
                return asdict(
                    await delete_after_defence(engine, store, settings.study_defence_date, today)
                )
            return asdict(
                await backup_every_workspace(engine, store, settings.study_defence_date, today)
            )
    finally:
        await engine.dispose()


def run_scheduled_backup() -> dict[str, int]:
    settings = load_settings(StudyBackupSettings)
    return asyncio.run(run(settings, "backup", datetime.now(UTC).date()))


def main(arguments: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m parfocal_api.study_backup",
        description="Back up the usability study sessions and traces, or delete the traces",
    )
    parser.add_argument("action", choices=("backup", "size", "delete"))
    chosen = parser.parse_args(arguments)
    settings = load_settings(StudyBackupSettings)
    print(json.dumps(asyncio.run(run(settings, chosen.action, datetime.now(UTC).date()))))


if __name__ == "__main__":
    main()
