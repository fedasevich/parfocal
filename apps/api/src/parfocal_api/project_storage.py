import uuid

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.problems import ConflictError
from parfocal_api.tables import UploadStatus, slides, uploads


class StorageFullError(ConflictError):
    code = "storage-full"
    title = "This project has no room left in its storage allowance for this file"


class ProjectRoom(BaseModel):
    used_bytes: int = Field(ge=0)
    needed_bytes: int = Field(ge=0)
    allowance_bytes: int | None = Field(gt=0)


async def used_bytes(connection: AsyncConnection, project_id: uuid.UUID) -> int:
    stored = await connection.scalar(
        select(func.coalesce(func.sum(slides.c.file_bytes), 0)).where(
            slides.c.project_id == project_id, slides.c.deleted_at.is_(None)
        )
    )
    arriving = await connection.scalar(
        select(func.coalesce(func.sum(uploads.c.size_bytes), 0)).where(
            uploads.c.project_id == project_id, uploads.c.status == UploadStatus.OPEN
        )
    )
    return int(stored or 0) + int(arriving or 0)


async def room_of(
    connection: AsyncConnection, project_id: uuid.UUID, needed: int, allowance: int | None
) -> ProjectRoom:
    used = await used_bytes(connection, project_id)
    return ProjectRoom(used_bytes=used, needed_bytes=needed, allowance_bytes=allowance)


async def require_room(
    connection: AsyncConnection, project_id: uuid.UUID, size: int, allowance: int | None
) -> None:
    if allowance is None:
        return
    if await used_bytes(connection, project_id) + size > allowance:
        raise StorageFullError
