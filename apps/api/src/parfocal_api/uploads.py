import re
import uuid
from collections.abc import Sequence
from datetime import datetime
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import ColumnElement, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal, ServicePrincipal
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.projects import visible
from parfocal_api.result_imports import (
    lock_slide_upload,
    published_slide_of,
    queue_if_ready,
    slide_upload_of,
)
from parfocal_api.result_sets import require_uploading
from parfocal_api.settings import ApiSettings
from parfocal_api.tables import UploadStatus, cases, job_steps, jobs, projects, slides, uploads
from parfocal_common.ingest import NOTICES, Failure, enqueue_ingest, failure_message
from parfocal_common.jobs import JobStatus, StepStatus
from parfocal_common.object_store import NoSuchUploadError, StorageError, StoredPart
from parfocal_common.pairing import Certainty, Rule
from parfocal_common.part_plan import MAX_PARTS, part_size_for, parts_problem, plan_parts
from parfocal_common.result_imports import (
    IMPORT_NOTICES,
    WAITING,
    ResultFormat,
    UploadKind,
    Waiting,
    can_sniff,
    format_of,
)

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
    kind: UploadKind = UploadKind.SLIDE
    result_format: ResultFormat | None = None
    slide_id: uuid.UUID | None = None
    slide_upload_id: uuid.UUID | None = None
    pairing_rule: Rule | None = None
    pairing_certainty: Certainty | None = None

    @model_validator(mode="after")
    def result_fields_only_on_results(self) -> UploadMetadata:
        result_fields = (
            self.result_format,
            self.slide_id,
            self.slide_upload_id,
            self.pairing_rule,
            self.pairing_certainty,
        )
        if self.kind is UploadKind.SLIDE and any(value is not None for value in result_fields):
            raise ValueError("Only a result file names a format, a slide or a pairing")
        if self.slide_id is not None and self.slide_upload_id is not None:
            raise ValueError("A result pairs with a slide or with a slide upload, not both")
        if (
            self.slide_id is None
            and self.slide_upload_id is None
            and (self.pairing_rule is not None or self.pairing_certainty is not None)
        ):
            raise ValueError("A pairing needs the slide it pairs with")
        return self


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
    job_id: uuid.UUID | None
    etag: str | None


class AbortedUpload(BaseModel):
    upload_id: uuid.UUID = Field(serialization_alias="uploadId")
    status: UploadStatus


class IngestStatus(StrEnum):
    UPLOADING = "uploading"
    WAITING = "waiting"
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
    kind: UploadKind
    status: IngestStatus
    upload_status: UploadStatus
    job_id: uuid.UUID | None
    step: str | None
    slide_id: uuid.UUID | None
    reason: str | None
    message: str | None
    notices: list[IngestNotice]
    result_format: ResultFormat | None
    slide_upload_id: uuid.UUID | None
    pairing_rule: Rule | None
    pairing_certainty: Certainty | None
    result_set_id: uuid.UUID | None


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


class ResultFormatUnknownError(BadRequestError):
    code = "result-format-unknown"
    title = "Name the format of this result file: GeoJSON, Parfocal JSON or CSV"


class PairedSlideNotFoundError(NotFoundError):
    code = "slide-not-found"
    title = "Slide not found in this project"


class SlideUploadNotFoundError(NotFoundError):
    code = "slide-upload-not-found"
    title = "No slide upload of yours in this project has this id"


def settings_of(request: Request) -> ApiSettings:
    return cast("ApiSettings", request.app.settings)


type Settings = Annotated[ApiSettings, Depends(settings_of)]

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


def completed_of(row: Any, job_id: uuid.UUID | None = None) -> CompletedUpload:
    job = job_id or row.job_id
    return CompletedUpload(
        location=(
            f"/api/projects/{row.project_id}/jobs/{job}"
            if job is not None
            else f"/api/uploads/{row.id}/status"
        ),
        key=row.object_key,
        upload_id=row.id,
        job_id=job,
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


async def paired_slide(
    connection: AsyncConnection, project_id: uuid.UUID, slide_id: uuid.UUID
) -> uuid.UUID:
    found = await connection.scalar(
        select(slides.c.id).where(
            slides.c.id == slide_id,
            slides.c.project_id == project_id,
            slides.c.deleted_at.is_(None),
        )
    )
    if found is None:
        raise PairedSlideNotFoundError
    return slide_id


async def paired_slide_upload(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    slide_upload_id: uuid.UUID,
) -> uuid.UUID | None:
    found = await connection.scalar(
        select(uploads.c.id).where(
            uploads.c.id == slide_upload_id,
            uploads.c.project_id == project_id,
            uploads.c.kind == UploadKind.SLIDE,
            uploads.c.status.in_([UploadStatus.OPEN, UploadStatus.COMPLETED]),
            created_by(principal),
        )
    )
    if found is None:
        raise SlideUploadNotFoundError
    return await published_slide_of(connection, slide_upload_id)


async def target_values(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    slide_id: uuid.UUID | None,
    slide_upload_id: uuid.UUID | None,
) -> dict[str, uuid.UUID | None]:
    if slide_id is not None:
        return {"slide_id": await paired_slide(connection, project_id, slide_id)}
    if slide_upload_id is not None:
        published = await paired_slide_upload(connection, principal, project_id, slide_upload_id)
        return {"slide_id": published, "slide_upload_id": slide_upload_id}
    return {}


async def result_values(
    connection: AsyncConnection,
    principal: Principal,
    project_id: uuid.UUID,
    meta: UploadMetadata,
    filename: str,
) -> dict[str, Any]:
    if meta.kind is UploadKind.SLIDE:
        return {}
    chosen = meta.result_format or format_of(filename)
    if chosen is None and not can_sniff(filename):
        raise ResultFormatUnknownError
    targets = await target_values(
        connection, principal, project_id, meta.slide_id, meta.slide_upload_id
    )
    pairing: dict[str, Any] = {}
    if targets:
        pairing = {
            "pairing_rule": meta.pairing_rule or Rule.PICKED,
            "pairing_certainty": meta.pairing_certainty or Certainty.SURE,
        }
    return {"kind": UploadKind.RESULT, "result_format": chosen, **targets, **pairing}


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
    paired = await result_values(connection, principal, project.id, meta, draft.filename)
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
            **paired,
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


def waiting(reason: Waiting) -> tuple[IngestStatus, str | None, str | None]:
    return IngestStatus.WAITING, reason, WAITING[reason]


def closed_status(upload_status: str) -> tuple[IngestStatus, str | None, str | None] | None:
    match UploadStatus(upload_status):
        case UploadStatus.OPEN:
            return IngestStatus.UPLOADING, None, None
        case UploadStatus.ABORTED:
            return failed(Failure.UPLOAD_ABORTED)
        case UploadStatus.EXPIRED:
            return failed(Failure.UPLOAD_EXPIRED)
        case UploadStatus.COMPLETED:
            return None


def job_status(job: Any) -> tuple[IngestStatus, str | None, str | None] | None:
    if job is not None and job.status == JobStatus.FAILED:
        return failed(job.error_code or "unknown")
    if job is not None and job.status in {JobStatus.CANCELLING, JobStatus.CANCELLED}:
        return failed(Failure.CHECK_STOPPED)
    return None


def ingest_status(
    upload_status: str, job: Any, slide: Any
) -> tuple[IngestStatus, str | None, str | None]:
    closed = closed_status(upload_status)
    if closed is not None:
        return closed
    if slide is not None:
        return IngestStatus.READY, None, None
    return job_status(job) or (IngestStatus.PROCESSING, None, None)


def slide_upload_refused(slide_upload: Any) -> bool:
    if slide_upload is None:
        return True
    if slide_upload.status in {UploadStatus.ABORTED, UploadStatus.EXPIRED}:
        return True
    return slide_upload.job_status in {
        JobStatus.FAILED,
        JobStatus.CANCELLING,
        JobStatus.CANCELLED,
    }


def result_status(
    row: Any, job: Any, imported: bool, slide_upload: Any
) -> tuple[IngestStatus, str | None, str | None]:
    closed = closed_status(row.status)
    if closed is not None:
        return closed
    if row.job_id is None:
        if row.slide_id is None and row.slide_upload_id is None:
            return waiting(Waiting.NEEDS_SLIDE)
        if row.slide_id is None and slide_upload_refused(slide_upload):
            return waiting(Waiting.SLIDE_REFUSED)
        return waiting(Waiting.WAITING_FOR_SLIDE)
    if imported:
        return IngestStatus.READY, None, None
    return job_status(job) or (IngestStatus.PROCESSING, None, None)


def notices_of(codes: Sequence[str]) -> list[IngestNotice]:
    known = {str(code): text for code, text in {**NOTICES, **IMPORT_NOTICES}.items()}
    return [IngestNotice(code=code, message=known.get(code, code)) for code in codes]


async def job_of(connection: AsyncConnection, job_id: uuid.UUID | None) -> tuple[Any, str | None]:
    if job_id is None:
        return None, None
    job = (
        await connection.execute(
            select(jobs.c.status, jobs.c.error_code).where(jobs.c.id == job_id)
        )
    ).one_or_none()
    step = await connection.scalar(
        select(job_steps.c.name)
        .where(
            job_steps.c.job_id == job_id,
            job_steps.c.status.in_([StepStatus.RUNNING, StepStatus.PENDING]),
        )
        .order_by(job_steps.c.ordinal)
        .limit(1)
    )
    return job, step


async def import_notices(connection: AsyncConnection, job_id: uuid.UUID | None) -> list[str]:
    if job_id is None:
        return []
    found = await connection.scalar(
        select(job_steps.c.result).where(
            job_steps.c.job_id == job_id, job_steps.c.status == StepStatus.DONE
        )
    )
    notices = cast("dict[str, Any]", found).get("notices") if isinstance(found, dict) else None
    return (
        [str(code) for code in cast("list[object]", notices)] if isinstance(notices, list) else []
    )


async def slide_upload_state(connection: AsyncConnection, slide_upload_id: uuid.UUID | None) -> Any:
    if slide_upload_id is None:
        return None
    return (
        await connection.execute(
            select(uploads.c.status, jobs.c.status.label("job_status"))
            .outerjoin(jobs, jobs.c.id == uploads.c.job_id)
            .where(uploads.c.id == slide_upload_id)
        )
    ).one_or_none()


def base_state(row: Any) -> dict[str, Any]:
    return {
        "upload_id": row.id,
        "project_id": row.project_id,
        "case_id": row.case_id,
        "kind": UploadKind(row.kind),
        "upload_status": UploadStatus(row.status),
        "job_id": row.job_id,
        "result_format": row.result_format,
        "slide_upload_id": row.slide_upload_id,
        "pairing_rule": row.pairing_rule,
        "pairing_certainty": row.pairing_certainty,
        "result_set_id": row.result_set_id,
    }


async def result_state(connection: AsyncConnection, row: Any) -> UploadState:
    job, step = await job_of(connection, row.job_id)
    imported = row.result_set_id is not None
    slide_upload = await slide_upload_state(connection, row.slide_upload_id)
    status, reason, message = result_status(row, job, imported, slide_upload)
    return UploadState(
        **base_state(row),
        status=status,
        step=step if status is IngestStatus.PROCESSING else None,
        slide_id=row.slide_id,
        reason=reason,
        message=message,
        notices=notices_of(await import_notices(connection, row.job_id)) if imported else [],
    )


async def slide_state(connection: AsyncConnection, row: Any) -> UploadState:
    job, step = await job_of(connection, row.job_id)
    slide = (
        await connection.execute(
            select(slides.c.id, slides.c.notices).where(
                slides.c.upload_id == row.id, slides.c.deleted_at.is_(None)
            )
        )
    ).one_or_none()
    status, reason, message = ingest_status(row.status, job, slide)
    return UploadState(
        **base_state(row),
        status=status,
        step=step if status is IngestStatus.PROCESSING else None,
        slide_id=slide.id if slide is not None else None,
        reason=reason,
        message=message,
        notices=notices_of(slide.notices) if slide is not None else [],
    )


async def state_of(connection: AsyncConnection, row: Any) -> UploadState:
    if row.kind == UploadKind.RESULT:
        return await result_state(connection, row)
    return await slide_state(connection, row)


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
    return await state_of(connection, row)


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
    await lock_slide_upload(connection, await slide_upload_of(connection, upload_id))
    row = await upload_row(connection, principal, upload_id, key)
    if row.status == UploadStatus.COMPLETED:
        return completed_of(row)
    require_open(row)
    stored = await stored_parts(store, settings, row)
    problem = completion_problem(stored, completion.parts, row)
    if problem is not None:
        raise UploadPartsInvalidError(problem)
    job_id = (
        await enqueue_ingest(connection, row.tenant_id, row.project_id, row.id)
        if row.kind == UploadKind.SLIDE
        else None
    )
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
    queued = await queue_if_ready(connection, finished)
    await audit(connection, principal, AuditAction.UPLOAD_COMPLETED, finished)
    return completed_of(finished, queued)


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
