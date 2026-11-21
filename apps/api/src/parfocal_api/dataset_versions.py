import hashlib
import io
import uuid
import zipfile
from collections import Counter
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ConflictError, NotFoundError
from parfocal_api.review_order import Results
from parfocal_api.review_tasks import code_of, readable_task
from parfocal_api.tables import dataset_versions, review_tasks, slides, users
from parfocal_api.task_kinds import annotate_only
from parfocal_api.tenant_provisioning import storage_prefix
from parfocal_api.training_exports import (
    MANIFEST,
    AppliedFilters,
    DatasetFilters,
    DatasetHiddenError,
    DatasetOrigin,
    Manifest,
    dataset,
    signed_off_slides,
    zipped,
)

NOTE_LENGTH = 500


class NothingChosenError(ConflictError):
    code = "nothing-chosen"
    title = "Choose at least one signed off slide and one object before freezing a version"


class DatasetVersionChangedError(ConflictError):
    code = "dataset-version-changed"
    title = "The stored dataset version no longer matches its checksum"


class SlideCounts(BaseModel):
    slide_id: uuid.UUID
    label: str
    objects: dict[DatasetOrigin, int]
    classes: dict[str, int]
    unchecked_left_out: int
    filtered_out: int


class DatasetSummary(BaseModel):
    filters: AppliedFilters
    signed_off_slides: int
    objects: dict[DatasetOrigin, int]
    classes: dict[str, int]
    unchecked_left_out: int
    filtered_out: int
    slides: list[SlideCounts]


class FreezeRequest(BaseModel):
    note: str = Field(default="", max_length=NOTE_LENGTH)
    filters: DatasetFilters = Field(default_factory=DatasetFilters)


class DatasetVersion(BaseModel):
    id: uuid.UUID
    number: int
    note: str
    filters: AppliedFilters
    counts: DatasetSummary
    sha256: str
    bytes: int
    created_at: datetime
    created_by: str | None


router = APIRouter(prefix="/api/review-tasks/{task_id}", tags=["review-tasks"])


def dataset_version_key(tenant_id: uuid.UUID, task_id: uuid.UUID, version_id: uuid.UUID) -> str:
    return f"{storage_prefix(tenant_id)}datasets/{task_id}/{version_id}.zip"


def user_of(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


async def whole_annotate_task(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID
) -> Any:
    task, whole = await readable_task(connection, principal, task_id)
    annotate_only(task.kind)
    if not whole:
        raise DatasetHiddenError
    return task


async def labels_of(connection: AsyncConnection, ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    rows = await connection.execute(select(slides.c.id, slides.c.label).where(slides.c.id.in_(ids)))
    return {row.id: row.label for row in rows}


async def summary_of(
    connection: AsyncConnection, manifest: Manifest, signed: int
) -> DatasetSummary:
    labels = await labels_of(connection, [entry.slide_id for entry in manifest.slides])
    objects: Counter[DatasetOrigin] = Counter()
    classes: Counter[str] = Counter()
    for entry in manifest.slides:
        objects.update(entry.objects)
        classes.update(entry.classes)
    return DatasetSummary(
        filters=manifest.filters,
        signed_off_slides=signed,
        objects={origin: objects[origin] for origin in DatasetOrigin},
        classes=dict(sorted(classes.items())),
        unchecked_left_out=manifest.unchecked_left_out,
        filtered_out=manifest.filtered_out,
        slides=[
            SlideCounts(
                slide_id=entry.slide_id,
                label=labels.get(entry.slide_id, ""),
                objects=entry.objects,
                classes=entry.classes,
                unchecked_left_out=entry.unchecked_left_out,
                filtered_out=entry.filtered_out,
            )
            for entry in manifest.slides
        ],
    )


async def built(
    connection: AsyncConnection, task: Any, results: Results, filters: DatasetFilters
) -> tuple[Manifest, dict[str, bytes], DatasetSummary]:
    manifest, files = await dataset(connection, task, results, filters)
    signed = len(await signed_off_slides(connection, task.id))
    return manifest, files, await summary_of(connection, manifest, signed)


@router.get(
    "/dataset", operation_id="getTaskDataset", **require(Permission.SEE_SLIDES, emergency=True)
)
async def get_task_dataset(
    task_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
    origin: Annotated[list[DatasetOrigin] | None, Query()] = None,
    class_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    slide_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    include_unchecked: bool | None = None,
) -> DatasetSummary:
    task = await whole_annotate_task(connection, principal, task_id)
    filters = DatasetFilters(
        origins=origin, class_ids=class_id, slide_ids=slide_id, include_unchecked=include_unchecked
    )
    _, _, summary = await built(connection, task, results, filters)
    return summary


def as_version(row: Any) -> DatasetVersion:
    return DatasetVersion(
        id=row.id,
        number=row.number,
        note=row.note,
        filters=AppliedFilters.model_validate(row.filters),
        counts=DatasetSummary.model_validate(row.counts),
        sha256=row.sha256,
        bytes=row.bytes,
        created_at=row.created_at,
        created_by=row.created_by,
    )


def versions_query(task_id: uuid.UUID) -> Any:
    return (
        select(dataset_versions, users.c.display_name.label("created_by"))
        .outerjoin(users, users.c.id == dataset_versions.c.created_by_user_id)
        .where(dataset_versions.c.task_id == task_id)
    )


@router.get(
    "/dataset-versions",
    operation_id="listDatasetVersions",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_dataset_versions(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[DatasetVersion]:
    await whole_annotate_task(connection, principal, task_id)
    rows = await connection.execute(
        versions_query(task_id).order_by(dataset_versions.c.number.desc())
    )
    return [as_version(row) for row in rows]


def frozen_zip(manifest: Manifest, files: dict[str, bytes], number: int) -> bytes:
    return zipped(manifest.model_copy(update={"dataset_version": number}), files)


@router.post(
    "/dataset-versions",
    operation_id="freezeDatasetVersion",
    status_code=201,
    **require(Permission.SEE_SLIDES, write=True, emergency=True),
)
async def freeze_dataset_version(
    task_id: uuid.UUID,
    body: FreezeRequest,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
    store: Store,
) -> DatasetVersion:
    task = await whole_annotate_task(connection, principal, task_id)
    await connection.execute(
        select(review_tasks.c.id).where(review_tasks.c.id == task_id).with_for_update()
    )
    manifest, files, summary = await built(connection, task, results, body.filters)
    if not manifest.slides or sum(summary.objects.values()) == 0:
        raise NothingChosenError
    number = (
        await connection.scalar(
            select(func.coalesce(func.max(dataset_versions.c.number), 0)).where(
                dataset_versions.c.task_id == task_id
            )
        )
    ) + 1
    content = frozen_zip(manifest, files, number)
    version_id = uuid.uuid4()
    key = dataset_version_key(task.tenant_id, task_id, version_id)
    await store.put_new_object(key, content, "application/zip")
    await connection.execute(
        insert(dataset_versions).values(
            id=version_id,
            tenant_id=task.tenant_id,
            project_id=task.project_id,
            task_id=task_id,
            number=number,
            note=body.note.strip(),
            filters=summary.filters.model_dump(mode="json"),
            counts=summary.model_dump(mode="json"),
            object_key=key,
            sha256=hashlib.sha256(content).hexdigest(),
            bytes=len(content),
            created_by_user_id=user_of(principal),
        )
    )
    row = (
        await connection.execute(versions_query(task_id).where(dataset_versions.c.id == version_id))
    ).one()
    return as_version(row)


async def version_row(connection: AsyncConnection, task_id: uuid.UUID, number: int) -> Any:
    row = (
        await connection.execute(
            select(dataset_versions).where(
                dataset_versions.c.task_id == task_id, dataset_versions.c.number == number
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Dataset version not found")
    return row


async def frozen_bytes(store: Any, row: Any) -> bytes:
    content: bytes = await store.get_object(row.object_key)
    if hashlib.sha256(content).hexdigest() != row.sha256:
        raise DatasetVersionChangedError
    return content


def frozen_parts(content: bytes) -> tuple[Manifest, dict[str, bytes]]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    return Manifest.model_validate_json(files.pop(MANIFEST)), files


@router.get(
    "/dataset-versions/{number}",
    operation_id="downloadDatasetVersion",
    response_class=Response,
    responses={
        200: {
            "description": "The frozen zip of the version, byte for byte as it was stored",
            "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def download_dataset_version(
    task_id: uuid.UUID,
    number: int,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
) -> Response:
    task = await whole_annotate_task(connection, principal, task_id)
    row = await version_row(connection, task_id, number)
    content = await frozen_bytes(store, row)
    return Response(
        content,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="parfocal-{code_of(task.number)}-dataset-v{number}.zip"'
            ),
            "X-Content-Type-Options": "nosniff",
            "X-Checksum-Sha256": row.sha256,
        },
    )
