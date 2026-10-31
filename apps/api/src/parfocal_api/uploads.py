import re
import uuid
from collections.abc import Sequence
from datetime import datetime
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import ColumnElement, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal, ServicePrincipal
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.projects import visible
from parfocal_api.result_sets import require_uploading
from parfocal_api.settings import ApiSettings
from parfocal_api.tables import UploadStatus, cases, job_steps, jobs, projects, slides, uploads
from parfocal_common.ingest import NOTICES, Failure, enqueue_ingest, failure_message
from parfocal_common.jobs import JobStatus, StepStatus
from parfocal_common.object_store import NoSuchUploadError, ObjectStore, StorageError, StoredPart
from parfocal_common.part_plan import MAX_PARTS, part_size_for, parts_problem, plan_parts

SAFE_CHARACTERS = re.compile(r"[^A-Za-z0-9._-]")
SAFE_NAME_LENGTH = 120
COMPANION = "/s3/multipart"
REFUSED_COMPLETIONS = frozenset({"InvalidPart", "InvalidPartOrder", "EntityTooSmall"})

type FileName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
]
type ObjectKey = Annotated[str, Query(min_length=1, max_length=512)]
type UploadId = Annotated[uuid.UUID, Path()]


class UploadMetadata(BaseModel):
    project_id: uuid.UUID
    case_id: uuid.UUID | None = None
    size: Annotated[int, Field(ge=1)]
    last_modified: Annotated[int, Field(ge=0)] | None = None


class UploadDraft(BaseModel):
    filename: FileName
    type: Annotated[str, StringConstraints(max_length=255)] | None = None
    metadata: UploadMetadata


class CreatedUpload(BaseModel):
    key: str
    upload_id: uuid.UUID = Field(serialization_alias="uploadId")
    part_size: int
    part_count: int


class OpenUpload(CreatedUpload):
    project_id: uuid.UUID
    case_id: uuid.UUID | None
    size: int
    created_at: datetime


class SignedPart(BaseModel):
    url: str
    expires: int


class UploadedPart(BaseModel):
    part_number: int = Field(serialization_alias="PartNumber")
    size: int = Field(serialization_alias="Size")
    etag: str = Field(serialization_alias="ETag")


class ClaimedPart(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    part_number: Annotated[int, Field(alias="PartNumber", ge=1, le=MAX_PARTS)]
    etag: Annotated[str, Field(alias="ETag", min_length=1, max_length=80)]


class Completion(BaseModel):
    parts: Annotated[list[ClaimedPart], Field(max_length=MAX_PARTS)]


class CompletedUpload(BaseModel):
    location: str
    key: str
    upload_id: uuid.UUID = Field(serialization_alias="uploadId")
    job_id: uuid.UUID
    etag: str | None


class AbortedUpload(BaseModel):
    upload_id: uuid.UUID = Field(serialization_alias="uploadId")
    status: UploadStatus


class IngestStatus(StrEnum):
    UPLOADING = "uploading"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class IngestNotice(BaseModel):
    code: str
    message: str


class UploadState(BaseModel):
    upload_id: uuid.UUID
    project_id: uuid.UUID
    case_id: uuid.UUID | None
    status: IngestStatus
    upload_status: UploadStatus
    job_id: uuid.UUID | None
    step: str | None
    slide_id: uuid.UUID | None
    reason: str | None
    message: str | None
    notices: list[IngestNotice]


class UploadTooLargeError(BadRequestError):
    code = "upload-too-large"
    title = "This file is larger than an upload may be"


class PartOutOfRangeError(BadRequestError):
    code = "part-out-of-range"
    title = "This part number is not part of the upload"


class UploadNotFoundError(NotFoundError):
    code = "upload-not-found"
    title = "Upload not found"


class NoOpenUploadError(NotFoundError):
    code = "no-open-upload"
    title = "No open upload matches this file"


class CaseNotFoundError(NotFoundError):
    code = "case-not-found"
    title = "Case not found in this project"


class UploadNotOpenError(ConflictError):
    code = "upload-not-open"
    title = "This upload is already finished or cancelled"


class UploadGoneError(ConflictError):
    code = "upload-gone"
    title = "This upload expired in storage. Start it again"


class UploadPartsInvalidError(ConflictError):
    code = "upload-parts-invalid"
    title = "The stored parts do not make up the whole file"


def settings_of(request: Request) -> ApiSettings:
    return cast("ApiSettings", request.app.settings)


def store_of(request: Request) -> ObjectStore:
    return cast("ObjectStore", request.app.state.storage)


type Settings = Annotated[ApiSettings, Depends(settings_of)]
type Store = Annotated[ObjectStore, Depends(store_of)]

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


def safe_name(name: str) -> str:
    cleaned = SAFE_CHARACTERS.sub("_", PurePosixPath(name.replace("\\", "/")).name)
    if cleaned.strip(".") == "":
        return "upload"
    if len(cleaned) <= SAFE_NAME_LENGTH:
        return cleaned
    suffix = PurePosixPath(cleaned).suffix[:20]
    return cleaned[: SAFE_NAME_LENGTH - len(suffix)] + suffix


def object_key(tenant_id: uuid.UUID, upload_id: uuid.UUID, name: str) -> str:
    return f"t/{tenant_id}/quarantine/{upload_id}/{safe_name(name)}"


def created_by(principal: Principal) -> ColumnElement[bool]:
    if isinstance(principal, ServicePrincipal):
        return uploads.c.created_by_service_id == principal.account_id
    assert isinstance(principal, MemberPrincipal)
    return uploads.c.created_by_user_id == principal.user_id


def creator_values(principal: Principal) -> dict[str, uuid.UUID]:
    if isinstance(principal, ServicePrincipal):
        return {"created_by_service_id": principal.account_id}
    assert isinstance(principal, MemberPrincipal)
    return {"created_by_user_id": principal.user_id}


def plan_of(row: Any) -> CreatedUpload:
    return CreatedUpload(
        key=row.object_key, upload_id=row.id, part_size=row.part_bytes, part_count=row.part_count
    )


async def upload_row(
    connection: AsyncConnection, principal: Principal, upload_id: uuid.UUID, key: str
) -> Any:
    row = (
        await connection.execute(
            select(uploads, projects.c.archived_at)
            .join(projects, projects.c.id == uploads.c.project_id)
            .where(uploads.c.id == upload_id, created_by(principal))
            .with_for_update(of=uploads)
        )
    ).one_or_none()
    if row is None or row.object_key != key:
        raise UploadNotFoundError
    await require_uploading(connection, principal, row.project_id, row.archived_at is not None)
    return row


def require_open(row: Any) -> None:
    if row.status != UploadStatus.OPEN:
        raise UploadNotOpenError


async def touch(connection: AsyncConnection, upload_id: uuid.UUID) -> None:
    await connection.execute(
        update(uploads).where(uploads.c.id == upload_id).values(last_activity_at=func.now())
    )


async def stored_parts(store: Store, settings: Settings, row: Any) -> list[StoredPart]:
    try:
        return await store.list_parts(
            row.object_key, row.storage_upload_id, settings.upload_list_page_size
        )
    except NoSuchUploadError as error:
        raise UploadGoneError from error


def completion_problem(
    stored: Sequence[StoredPart], claimed: Sequence[ClaimedPart], row: Any
) -> str | None:
    problem = parts_problem(stored, row.size_bytes, row.part_bytes)
    if problem is not None:
        return problem
    etags = {part.part_number: part.etag.strip().strip('"') for part in claimed}
    if set(etags) != {part.part_number for part in stored}:
        return "The parts sent are not the parts stored"
    for part in stored:
        if etags[part.part_number] != part.etag:
            return f"Part {part.part_number} has another ETag"
    return None


def completed_of(row: Any) -> CompletedUpload:
    return CompletedUpload(
        location=f"/api/projects/{row.project_id}/jobs/{row.job_id}",
        key=row.object_key,
        upload_id=row.id,
        job_id=row.job_id,
        etag=row.etag,
    )


async def audit(
    connection: AsyncConnection, principal: Principal, action: AuditAction, row: Any
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.UPLOAD,
        row.id,
        tenant_id=row.tenant_id,
        details={
            "project_id": str(row.project_id),
            "case_id": str(row.case_id) if row.case_id else None,
            "size_bytes": row.size_bytes,
            "part_count": row.part_count,
        },
    )


@router.post(
    COMPANION,
    operation_id="createUpload",
    status_code=201,
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def create_upload(
    draft: UploadDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
    store: Store,
) -> CreatedUpload:
    meta = draft.metadata
    if meta.size > settings.upload_max_bytes:
        raise UploadTooLargeError(f"The largest upload is {settings.upload_max_bytes} bytes")
    project = await visible(connection, principal, meta.project_id)
    await require_uploading(connection, principal, project.id, project.archived_at is not None)
    if meta.case_id is not None:
        found = await connection.scalar(
            select(cases.c.id).where(
                cases.c.id == meta.case_id,
                cases.c.project_id == project.id,
                cases.c.deleted_at.is_(None),
            )
        )
        if found is None:
            raise CaseNotFoundError
    plan = plan_parts(meta.size, part_size_for(meta.size, settings.upload_part_bytes))
    upload_id = uuid.uuid4()
    key = object_key(project.tenant_id, upload_id, draft.filename)
    storage_upload_id = await store.create_multipart_upload(key)
    await connection.execute(
        insert(uploads).values(
            id=upload_id,
            tenant_id=project.tenant_id,
            project_id=project.id,
            case_id=meta.case_id,
            file_name=draft.filename,
            size_bytes=meta.size,
            last_modified_ms=meta.last_modified,
            object_key=key,
            storage_upload_id=storage_upload_id,
            part_bytes=plan.part_bytes,
            part_count=plan.part_count,
            **creator_values(principal),
        )
    )
    return CreatedUpload(
        key=key, upload_id=upload_id, part_size=plan.part_bytes, part_count=plan.part_count
    )


@router.get(
    "/open",
    operation_id="findOpenUpload",
    **require(Permission.UPLOAD_SLIDES),
)
async def find_open_upload(
    project_id: uuid.UUID,
    name: Annotated[str, Query(min_length=1, max_length=255)],
    size: Annotated[int, Query(ge=1)],
    principal: CurrentPrincipal,
    connection: TenantConnection,
    last_modified: Annotated[int | None, Query(ge=0)] = None,
) -> OpenUpload:
    await visible(connection, principal, project_id)
    row = (
        await connection.execute(
            select(uploads)
            .where(
                uploads.c.project_id == project_id,
                uploads.c.file_name == name.strip(),
                uploads.c.size_bytes == size,
                uploads.c.last_modified_ms.is_not_distinct_from(last_modified),
                uploads.c.status == UploadStatus.OPEN,
                created_by(principal),
            )
            .order_by(uploads.c.created_at.desc())
            .limit(1)
        )
    ).one_or_none()
    if row is None:
        raise NoOpenUploadError
    return OpenUpload(
        **plan_of(row).model_dump(),
        project_id=row.project_id,
        case_id=row.case_id,
        size=row.size_bytes,
        created_at=row.created_at,
    )


def failed(reason: str) -> tuple[IngestStatus, str | None, str | None]:
    return IngestStatus.FAILED, reason, failure_message(reason)


def ingest_status(
    upload_status: str, job: Any, slide: Any
) -> tuple[IngestStatus, str | None, str | None]:
    match UploadStatus(upload_status):
        case UploadStatus.OPEN:
            return IngestStatus.UPLOADING, None, None
        case UploadStatus.ABORTED:
            return failed(Failure.UPLOAD_ABORTED)
        case UploadStatus.EXPIRED:
            return failed(Failure.UPLOAD_EXPIRED)
        case UploadStatus.COMPLETED:
            pass
    if slide is not None:
        return IngestStatus.READY, None, None
    if job is not None and job.status == JobStatus.FAILED:
        return failed(job.error_code or "unknown")
    if job is not None and job.status in {JobStatus.CANCELLING, JobStatus.CANCELLED}:
        return failed(Failure.CHECK_STOPPED)
    return IngestStatus.PROCESSING, None, None


def notices_of(codes: Sequence[str]) -> list[IngestNotice]:
    known = {str(code): text for code, text in NOTICES.items()}
    return [IngestNotice(code=code, message=known.get(code, code)) for code in codes]


@router.get(
    "/{upload_id}/status",
    operation_id="getUploadStatus",
    **require(Permission.UPLOAD_SLIDES),
)
async def get_upload_status(
    upload_id: UploadId, principal: CurrentPrincipal, connection: TenantConnection
) -> UploadState:
    row = (
        await connection.execute(
            select(uploads).where(uploads.c.id == upload_id, created_by(principal))
        )
    ).one_or_none()
    if row is None:
        raise UploadNotFoundError
    job = None
    step = None
    if row.job_id is not None:
        job = (
            await connection.execute(
                select(jobs.c.status, jobs.c.error_code).where(jobs.c.id == row.job_id)
            )
        ).one_or_none()
        step = await connection.scalar(
            select(job_steps.c.name)
            .where(
                job_steps.c.job_id == row.job_id,
                job_steps.c.status.in_([StepStatus.RUNNING, StepStatus.PENDING]),
            )
            .order_by(job_steps.c.ordinal)
            .limit(1)
        )
    slide = (
        await connection.execute(
            select(slides.c.id, slides.c.notices).where(
                slides.c.upload_id == row.id, slides.c.deleted_at.is_(None)
            )
        )
    ).one_or_none()
    status, reason, message = ingest_status(row.status, job, slide)
    return UploadState(
        upload_id=row.id,
        project_id=row.project_id,
        case_id=row.case_id,
        status=status,
        upload_status=UploadStatus(row.status),
        job_id=row.job_id,
        step=step if status is IngestStatus.PROCESSING else None,
        slide_id=slide.id if slide is not None else None,
        reason=reason,
        message=message,
        notices=notices_of(slide.notices) if slide is not None else [],
    )


@router.get(
    COMPANION + "/{upload_id}/{part_number}",
    operation_id="signUploadPart",
    **require(Permission.UPLOAD_SLIDES),
)
async def sign_upload_part(
    upload_id: UploadId,
    part_number: Annotated[int, Path(ge=1, le=MAX_PARTS)],
    key: ObjectKey,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
    store: Store,
) -> SignedPart:
    row = await upload_row(connection, principal, upload_id, key)
    require_open(row)
    if part_number > row.part_count:
        raise PartOutOfRangeError(f"This upload has parts 1 to {row.part_count}")
    await touch(connection, upload_id)
    url = store.presign_part(
        row.object_key, row.storage_upload_id, part_number, settings.upload_part_url_seconds
    )
    return SignedPart(url=url, expires=settings.upload_part_url_seconds)


@router.get(
    COMPANION + "/{upload_id}",
    operation_id="listUploadParts",
    **require(Permission.UPLOAD_SLIDES),
)
async def list_upload_parts(
    upload_id: UploadId,
    key: ObjectKey,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
    store: Store,
) -> list[UploadedPart]:
    row = await upload_row(connection, principal, upload_id, key)
    require_open(row)
    await touch(connection, upload_id)
    return [
        UploadedPart(part_number=part.part_number, size=part.size, etag=part.etag)
        for part in await stored_parts(store, settings, row)
    ]


@router.post(
    COMPANION + "/{upload_id}/complete",
    operation_id="completeUpload",
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def complete_upload(
    upload_id: UploadId,
    key: ObjectKey,
    completion: Completion,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
    store: Store,
) -> CompletedUpload:
    row = await upload_row(connection, principal, upload_id, key)
    if row.status == UploadStatus.COMPLETED:
        return completed_of(row)
    require_open(row)
    stored = await stored_parts(store, settings, row)
    problem = completion_problem(stored, completion.parts, row)
    if problem is not None:
        raise UploadPartsInvalidError(problem)
    job_id = await enqueue_ingest(connection, row.tenant_id, row.project_id, row.id)
    try:
        completed = await store.complete_multipart_upload(
            row.object_key, row.storage_upload_id, stored
        )
    except NoSuchUploadError as error:
        raise UploadGoneError from error
    except StorageError as error:
        if error.code not in REFUSED_COMPLETIONS:
            raise
        raise UploadPartsInvalidError(f"Storage refused the parts with {error.code}") from error
    finished = (
        await connection.execute(
            update(uploads)
            .where(uploads.c.id == upload_id)
            .values(
                status=UploadStatus.COMPLETED,
                closed_at=func.now(),
                job_id=job_id,
                etag=completed.etag or None,
            )
            .returning(uploads)
        )
    ).one()
    await audit(connection, principal, AuditAction.UPLOAD_COMPLETED, finished)
    return completed_of(finished)


@router.delete(
    COMPANION + "/{upload_id}",
    operation_id="abortUpload",
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def abort_upload(
    upload_id: UploadId,
    key: ObjectKey,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
) -> AbortedUpload:
    row = await upload_row(connection, principal, upload_id, key)
    if row.status in {UploadStatus.ABORTED, UploadStatus.EXPIRED}:
        return AbortedUpload(upload_id=row.id, status=UploadStatus(row.status))
    require_open(row)
    await store.abort_multipart_upload(row.object_key, row.storage_upload_id)
    await connection.execute(
        update(uploads)
        .where(uploads.c.id == upload_id)
        .values(status=UploadStatus.ABORTED, closed_at=func.now())
    )
    await audit(connection, principal, AuditAction.UPLOAD_ABORTED, row)
    return AbortedUpload(upload_id=row.id, status=UploadStatus.ABORTED)
