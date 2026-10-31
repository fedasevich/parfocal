import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy import func, insert, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, record
from parfocal_api.notification_catalogue import TargetKind
from parfocal_api.notifications import notify
from parfocal_api.retention import SYSTEM
from parfocal_api.tables import NotificationKind, slides, uploads

LABEL_LENGTH = 200
LABEL_STEM_LENGTH = 180
LABEL_ATTEMPTS = 5
DOUBLE_SUFFIXES = (".ome.tiff", ".ome.tif")


@dataclass(frozen=True)
class SlideFacts:
    slide_id: uuid.UUID
    format: str
    variant: str | None
    reader: str
    width: int
    height: int
    level_count: int
    mpp_x: float | None
    mpp_y: float | None
    objective_power: float | None
    notices: Sequence[str]
    file_bytes: int
    sha256: str
    original_key: str
    restricted_images: Sequence[str]


async def upload_of(connection: AsyncConnection, upload_id: uuid.UUID) -> Any:
    return (
        await connection.execute(select(uploads).where(uploads.c.id == upload_id))
    ).one_or_none()


def label_of(file_name: str) -> str:
    name = PurePosixPath(file_name.replace("\\", "/")).name
    lowered = name.lower()
    double = next((suffix for suffix in DOUBLE_SUFFIXES if lowered.endswith(suffix)), None)
    stem = name[: -len(double)] if double else PurePosixPath(name).stem
    return (stem.strip() or "Slide")[:LABEL_STEM_LENGTH]


async def taken_labels(
    connection: AsyncConnection, project_id: uuid.UUID, case_id: uuid.UUID | None, stem: str
) -> set[str]:
    place = (
        slides.c.case_id == case_id
        if case_id is not None
        else (slides.c.project_id == project_id) & slides.c.case_id.is_(None)
    )
    rows = await connection.scalars(
        select(slides.c.label).where(
            place,
            slides.c.deleted_at.is_(None),
            or_(slides.c.label == stem, slides.c.label.startswith(f"{stem} (", autoescape=True)),
        )
    )
    return set(rows)


def free_label(stem: str, taken: set[str]) -> str:
    if stem not in taken:
        return stem
    number = 2
    while f"{stem} ({number})" in taken:
        number += 1
    return f"{stem} ({number})"[:LABEL_LENGTH]


async def published_slide(connection: AsyncConnection, upload_id: uuid.UUID) -> uuid.UUID | None:
    return await connection.scalar(select(slides.c.id).where(slides.c.upload_id == upload_id))


async def insert_slide(connection: AsyncConnection, upload: Any, facts: SlideFacts) -> None:
    stem = label_of(upload.file_name)
    for _ in range(LABEL_ATTEMPTS):
        label = free_label(
            stem, await taken_labels(connection, upload.project_id, upload.case_id, stem)
        )
        try:
            async with connection.begin_nested():
                await connection.execute(
                    insert(slides).values(
                        id=facts.slide_id,
                        tenant_id=upload.tenant_id,
                        project_id=upload.project_id,
                        case_id=upload.case_id,
                        label=label,
                        upload_id=upload.id,
                        format=facts.format,
                        variant=facts.variant,
                        reader=facts.reader,
                        width=facts.width,
                        height=facts.height,
                        level_count=facts.level_count,
                        mpp_x=facts.mpp_x,
                        mpp_y=facts.mpp_y,
                        objective_power=facts.objective_power,
                        notices=list(facts.notices),
                        file_bytes=facts.file_bytes,
                        sha256=facts.sha256,
                        original_key=facts.original_key,
                        restricted_images=list(facts.restricted_images),
                        published_at=func.now(),
                    )
                )
            return
        except IntegrityError:
            continue
    raise RuntimeError("no free slide label")


async def publish_slide(connection: AsyncConnection, upload: Any, facts: SlideFacts) -> bool:
    if await published_slide(connection, upload.id) is not None:
        return False
    await insert_slide(connection, upload, facts)
    await record(
        connection,
        SYSTEM,
        AuditAction.SLIDE_PUBLISHED,
        AuditTarget.SLIDE,
        facts.slide_id,
        tenant_id=upload.tenant_id,
        details={
            "upload_id": str(upload.id),
            "project_id": str(upload.project_id),
            "case_id": str(upload.case_id) if upload.case_id else None,
            "format": facts.format,
            "file_bytes": facts.file_bytes,
            "sha256": facts.sha256,
        },
    )
    if upload.created_by_user_id is not None and upload.job_id is not None:
        await notify(
            connection,
            upload.tenant_id,
            [upload.created_by_user_id],
            NotificationKind.UPLOAD_DONE,
            TargetKind.JOB,
            upload.job_id,
            {"upload_id": str(upload.id), "slide_id": str(facts.slide_id)},
        )
    return True


async def record_refusal(connection: AsyncConnection, upload: Any, code: str) -> None:
    await record(
        connection,
        SYSTEM,
        AuditAction.UPLOAD_REFUSED,
        AuditTarget.UPLOAD,
        upload.id,
        tenant_id=upload.tenant_id,
        details={"project_id": str(upload.project_id), "reason": code},
    )
