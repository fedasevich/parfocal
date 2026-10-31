import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.result_sets import (
    RegionRow,
    ResultSetDraft,
    add_regions,
    finish,
    insert_result_set,
)
from parfocal_api.retention import SYSTEM
from parfocal_api.tables import (
    ResultObjectKind,
    ResultSource,
    ResultStatus,
    UploadStatus,
    result_objects,
    result_sets,
    slides,
    uploads,
)
from parfocal_common.result_imports import UploadKind, enqueue_result_import


async def published_slide_of(
    connection: AsyncConnection, slide_upload_id: uuid.UUID
) -> uuid.UUID | None:
    return await connection.scalar(
        select(slides.c.id).where(
            slides.c.upload_id == slide_upload_id, slides.c.deleted_at.is_(None)
        )
    )


async def lock_slide_upload(
    connection: AsyncConnection, slide_upload_id: uuid.UUID | None, *, exclusive: bool = False
) -> None:
    if slide_upload_id is None:
        return
    await connection.execute(
        select(uploads.c.id)
        .where(uploads.c.id == slide_upload_id)
        .with_for_update(read=not exclusive)
    )


async def slide_upload_of(connection: AsyncConnection, upload_id: uuid.UUID) -> uuid.UUID | None:
    return await connection.scalar(
        select(uploads.c.slide_upload_id).where(uploads.c.id == upload_id)
    )


async def queue_if_ready(connection: AsyncConnection, row: Any) -> uuid.UUID | None:
    if row.kind != UploadKind.RESULT or row.result_set_id is not None:
        return None
    slide_id = row.slide_id
    if slide_id is None and row.slide_upload_id is not None:
        slide_id = await published_slide_of(connection, row.slide_upload_id)
        if slide_id is not None:
            await connection.execute(
                update(uploads).where(uploads.c.id == row.id).values(slide_id=slide_id)
            )
    if slide_id is None or row.status != UploadStatus.COMPLETED or row.job_id is not None:
        return None
    job_id = await enqueue_result_import(connection, row.tenant_id, row.project_id, row.id)
    await connection.execute(update(uploads).where(uploads.c.id == row.id).values(job_id=job_id))
    return job_id


async def queue_waiting_results(
    connection: AsyncConnection, slide_upload_id: uuid.UUID, slide_id: uuid.UUID
) -> list[uuid.UUID]:
    await lock_slide_upload(connection, slide_upload_id, exclusive=True)
    rows = (
        await connection.execute(
            update(uploads)
            .where(
                uploads.c.slide_upload_id == slide_upload_id,
                uploads.c.kind == UploadKind.RESULT,
                uploads.c.slide_id.is_(None),
                uploads.c.result_set_id.is_(None),
            )
            .values(slide_id=slide_id)
            .returning(uploads)
        )
    ).all()
    queued: list[uuid.UUID] = []
    for row in rows:
        job_id = await queue_if_ready(connection, row)
        if job_id is not None:
            queued.append(job_id)
    return queued


async def locked_result_upload(connection: AsyncConnection, upload_id: uuid.UUID) -> Any:
    return (
        await connection.execute(select(uploads).where(uploads.c.id == upload_id).with_for_update())
    ).one_or_none()


async def import_target(connection: AsyncConnection, slide_id: uuid.UUID) -> Any:
    return (
        await connection.execute(
            select(slides.c.id, slides.c.project_id).where(
                slides.c.id == slide_id, slides.c.deleted_at.is_(None)
            )
        )
    ).one_or_none()


async def known_objects(
    connection: AsyncConnection, slide_id: uuid.UUID, kind: ResultObjectKind
) -> list[tuple[int, str]]:
    rows = await connection.execute(
        select(result_objects.c.number, func.ST_AsText(result_objects.c.geometry))
        .join(result_sets, result_sets.c.id == result_objects.c.result_set_id)
        .where(
            result_sets.c.slide_id == slide_id,
            result_sets.c.status == ResultStatus.READY,
            result_sets.c.deleted_at.is_(None),
            result_objects.c.kind == kind,
        )
        .order_by(result_sets.c.created_at, result_objects.c.number)
    )
    latest = {int(number): str(wkt) for number, wkt in rows}
    return sorted(latest.items())


async def store_result_set(
    connection: AsyncConnection,
    upload: Any,
    slide: Any,
    set_id: uuid.UUID,
    draft: ResultSetDraft,
    regions: Sequence[RegionRow],
    job_id: uuid.UUID | None,
) -> None:
    await insert_result_set(
        connection,
        upload.tenant_id,
        slide,
        draft,
        ResultSource.IMPORT,
        SYSTEM,
        upload.created_by_user_id,
        job_id,
        set_id,
    )
    await add_regions(connection, set_id, regions)
    await finish(connection, set_id)
    await connection.execute(
        update(uploads).where(uploads.c.id == upload.id).values(result_set_id=set_id)
    )
