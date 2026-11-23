import argparse
import asyncio
import hashlib
import io
import os
import tempfile
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx2
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_api.dataset_versions import frozen_parts
from parfocal_api.patch_exports import PATCH_KIND, patch_export_key
from parfocal_api.showcase import DEPLOYED_ENVS, seed, viewer_emails_of
from parfocal_api.showcase_outcomes import OUTCOME_TASK
from parfocal_api.showcase_timing import took
from parfocal_api.tables import review_tasks, slides
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.jobs import JobStatus, jobs
from parfocal_common.object_store import ObjectStore, StorageError
from parfocal_common.result_store import ObjectResultStore
from parfocal_common.settings import AppEnv, StorageSettings
from parfocal_ingest.patch_export import PatchWriter, source_of

NOT_FOUND = 404


class SeededExportError(RuntimeError):
    pass


@dataclass(frozen=True)
class SeededExport:
    job_id: uuid.UUID
    tenant_id: uuid.UUID
    arguments: Mapping[str, Any]


async def done_exports(engine: AsyncEngine) -> list[SeededExport]:
    async with scoped_transaction(engine, DatabaseScope(platform=True)) as connection:
        rows = await connection.execute(
            select(jobs.c.id, jobs.c.tenant_id, jobs.c.input)
            .where(jobs.c.kind == PATCH_KIND, jobs.c.status == JobStatus.DONE)
            .order_by(jobs.c.created_at)
        )
        return [SeededExport(row.id, row.tenant_id, row.input) for row in rows]


async def originals_of(
    engine: AsyncEngine, export: SeededExport, slide_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str] | None:
    async with scoped_transaction(engine, DatabaseScope(tenant_id=export.tenant_id)) as connection:
        name = await connection.scalar(
            select(review_tasks.c.name).where(
                review_tasks.c.id == uuid.UUID(str(export.arguments["task_id"]))
            )
        )
        if name != OUTCOME_TASK:
            return None
        rows = await connection.execute(
            select(slides.c.id, slides.c.original_key).where(slides.c.id.in_(slide_ids))
        )
        return {row.id: row.original_key for row in rows if row.original_key}


class Originals:
    def __init__(self, store: ObjectStore, folder: Path) -> None:
        self.store = store
        self.folder = folder
        self.fetched: dict[str, Path | None] = {}

    async def path_of(self, key: str) -> Path | None:
        if key not in self.fetched:
            target = self.folder / str(len(self.fetched)) / Path(key).name
            target.parent.mkdir(parents=True)
            try:
                await self.store.download(key, target)
            except StorageError as error:
                if error.status != NOT_FOUND:
                    raise
                self.fetched[key] = None
            else:
                self.fetched[key] = target
        return self.fetched[key]


def cut(
    arguments: Mapping[str, Any], content: bytes, paths: Mapping[uuid.UUID, Path | None]
) -> tuple[bytes, int]:
    made, files = frozen_parts(content)
    buffer = io.BytesIO()
    writer = PatchWriter(buffer, int(arguments["level"]), int(arguments["tile_size"]), coco=True)
    for entry in made.slides:
        path = paths.get(entry.slide_id)
        if path is None:
            writer.skip(entry.slide_id, "no-file")
            continue
        source = source_of(entry.slide_id, path, files[entry.file.path])
        if source is None:
            writer.skip(entry.slide_id, "unreadable")
            continue
        writer.add(source)
    writer.finish(made.task, made.classes, made.dataset_version)
    return buffer.getvalue(), len(writer.objects)


async def cut_one(
    engine: AsyncEngine, store: ObjectStore, originals: Originals, export: SeededExport
) -> int | None:
    if export.arguments.get("format") != "coco" or "dataset_key" not in export.arguments:
        return None
    if await store.head_object(patch_export_key(export.tenant_id, export.job_id)) is not None:
        return None
    content = await store.get_object(str(export.arguments["dataset_key"]))
    if hashlib.sha256(content).hexdigest() != export.arguments["dataset_sha256"]:
        raise SeededExportError(f"the frozen dataset of export {export.job_id} changed")
    made, _ = frozen_parts(content)
    keys = await originals_of(engine, export, [entry.slide_id for entry in made.slides])
    if keys is None:
        return None
    paths = {slide_id: await originals.path_of(key) for slide_id, key in keys.items()}
    zipped, annotations = await asyncio.to_thread(cut, export.arguments, content, paths)
    await store.put_object(
        patch_export_key(export.tenant_id, export.job_id), zipped, "application/zip"
    )
    return annotations


async def cut_seeded_exports(
    database_url: str, store: ObjectStore, *, require_annotations: bool = False
) -> list[int]:
    started = time.monotonic()
    counts: list[int] = []
    engine = create_engine(database_url)
    try:
        with tempfile.TemporaryDirectory(prefix="seeded-exports-") as folder:
            originals = Originals(store, Path(folder))
            for export in await done_exports(engine):
                annotations = await cut_one(engine, store, originals, export)
                if annotations is None:
                    continue
                if require_annotations and annotations == 0:
                    raise SeededExportError(f"the seeded export {export.job_id} is empty")
                counts.append(annotations)
    finally:
        await engine.dispose()
    took("patch exports", started)
    return counts


async def main() -> None:
    parser = argparse.ArgumentParser(
        prog="parfocal_ingest.showcase_seed",
        description="Seed the ČVUT workspaces with invented people over every feature",
    )
    parser.parse_args()
    database_url = os.environ["DATABASE_URL"]
    settings = StorageSettings(app_env=AppEnv(os.environ.get("APP_ENV", AppEnv.DEV)))
    async with httpx2.AsyncClient(timeout=60) as http:
        store = ObjectStore(settings.storage(), http)
        tenant_ids = await seed(
            database_url,
            store,
            ObjectResultStore(store),
            os.environ.get("SEED_OWNER_EMAIL") or None,
            viewer_emails=viewer_emails_of(os.environ.get("SEED_VIEWER_EMAILS", "")),
            agent_emails=viewer_emails_of(os.environ.get("SEED_AGENT_EMAILS", "")),
            require_fixture_folders=settings.app_env in DEPLOYED_ENVS,
        )
        await cut_seeded_exports(
            database_url, store, require_annotations=settings.app_env in DEPLOYED_ENVS
        )
    print(f"seeded {len(tenant_ids)} ČVUT workspaces")


if __name__ == "__main__":
    asyncio.run(main())
