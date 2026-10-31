import uuid
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import ConflictError
from parfocal_api.projects import visible
from parfocal_api.result_imports import lock_slide_upload, queue_if_ready
from parfocal_api.result_sets import require_uploading
from parfocal_api.tables import UploadStatus, cases, jobs, projects, slides, uploads
from parfocal_api.uploads import (
    CaseNotFoundError,
    UploadId,
    UploadNotFoundError,
    UploadNotOpenError,
    UploadState,
    created_by,
    state_of,
    target_values,
)
from parfocal_common.jobs import JobStatus
from parfocal_common.pairing import (
    HEAD_BYTES,
    Certainty,
    FileKind,
    Outcome,
    PairBy,
    ResultFile,
    Rule,
    SlideCandidate,
    embedded_hint,
    kind_of,
    pair_results,
)
from parfocal_common.result_imports import UploadKind

MAX_FILES = 5000
EXISTING = "slide:"

type DroppedPath = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1024)
]


class DroppedFile(BaseModel):
    path: DroppedPath
    kind: FileKind | None = None
    head: Annotated[str, Field(max_length=HEAD_BYTES)] | None = None


class PairingRequest(BaseModel):
    project_id: uuid.UUID
    case_id: uuid.UUID | None = None
    by: PairBy = PairBy.AUTO
    files: Annotated[list[DroppedFile], Field(min_length=1, max_length=MAX_FILES)]


class PairedSlide(BaseModel):
    path: str | None
    slide_id: uuid.UUID | None


class ResultPairing(BaseModel):
    path: str
    outcome: Outcome
    slide: PairedSlide | None
    rule: Rule | None
    certainty: Certainty | None
    candidates: list[PairedSlide]


class Pairings(BaseModel):
    slides: list[str]
    results: list[ResultPairing]
    others: list[str]


class SlideChoice(BaseModel):
    slide_id: uuid.UUID | None = None
    slide_upload_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def exactly_one(self) -> SlideChoice:
        if (self.slide_id is None) == (self.slide_upload_id is None):
            raise ValueError("Name either a slide or a slide upload")
        return self


class NotAResultUploadError(ConflictError):
    code = "not-a-result-upload"
    title = "This upload is a slide, not a result file"


class ResultAlreadyImportedError(ConflictError):
    code = "result-already-imported"
    title = "This result is already imported, and an imported result set cannot move"


class ResultImportStartedError(ConflictError):
    code = "result-import-started"
    title = "This result is being imported now"


class ResultImportEndedError(ConflictError):
    code = "result-import-ended"
    title = "Importing this result has ended. Upload it again to pair it with another slide"


router = APIRouter(prefix="/api/uploads", tags=["uploads"])


def slide_of(key: str) -> PairedSlide:
    if key.startswith(EXISTING):
        return PairedSlide(path=None, slide_id=uuid.UUID(key.removeprefix(EXISTING)))
    return PairedSlide(path=key, slide_id=None)


async def existing_slides(
    connection: AsyncConnection, project_id: uuid.UUID, case_id: uuid.UUID | None
) -> list[SlideCandidate]:
    if case_id is not None:
        found = await connection.scalar(
            select(cases.c.id).where(
                cases.c.id == case_id,
                cases.c.project_id == project_id,
                cases.c.deleted_at.is_(None),
            )
        )
        if found is None:
            raise CaseNotFoundError
    place = (
        slides.c.case_id == case_id if case_id is not None else slides.c.project_id == project_id
    )
    rows = await connection.execute(
        select(slides.c.id, slides.c.label).where(
            place, slides.c.project_id == project_id, slides.c.deleted_at.is_(None)
        )
    )
    return [
        SlideCandidate(key=f"{EXISTING}{row.id}", name=row.label, slide_id=str(row.id))
        for row in rows
    ]


@router.post(
    "/pairings",
    operation_id="pairResultFiles",
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def pair_result_files(
    request: PairingRequest, principal: CurrentPrincipal, connection: TenantConnection
) -> Pairings:
    project = await visible(connection, principal, request.project_id)
    await require_uploading(connection, principal, project.id, project.archived_at is not None)
    kinds = {item.path: item.kind or kind_of(item.path) for item in request.files}
    dropped = [
        SlideCandidate(key=path, name=path, path=path)
        for path, kind in kinds.items()
        if kind is FileKind.SLIDE
    ]
    candidates = [*dropped, *await existing_slides(connection, project.id, request.case_id)]
    results = [
        ResultFile(item.path, embedded_hint(item.head, item.path) if item.head else None)
        for item in request.files
        if kinds[item.path] is FileKind.RESULT
    ]
    pairings = pair_results(results, candidates, request.by)
    return Pairings(
        slides=[slide.key for slide in dropped],
        results=[
            ResultPairing(
                path=pairing.path,
                outcome=pairing.outcome,
                slide=slide_of(pairing.slide) if pairing.slide is not None else None,
                rule=pairing.rule,
                certainty=pairing.certainty,
                candidates=[slide_of(key) for key in pairing.candidates],
            )
            for pairing in pairings
        ],
        others=[path for path, kind in kinds.items() if kind is FileKind.OTHER],
    )


async def overridable(
    connection: AsyncConnection, principal: Principal, upload_id: uuid.UUID
) -> Any:
    peeked = await connection.scalar(
        select(uploads.c.slide_upload_id).where(uploads.c.id == upload_id, created_by(principal))
    )
    await lock_slide_upload(connection, peeked)
    row = (
        await connection.execute(
            select(uploads, projects.c.archived_at)
            .join(projects, projects.c.id == uploads.c.project_id)
            .where(uploads.c.id == upload_id, created_by(principal))
            .with_for_update(of=uploads)
        )
    ).one_or_none()
    if row is None:
        raise UploadNotFoundError
    await require_uploading(connection, principal, row.project_id, row.archived_at is not None)
    if row.kind != UploadKind.RESULT:
        raise NotAResultUploadError
    if row.status in {UploadStatus.ABORTED, UploadStatus.EXPIRED}:
        raise UploadNotOpenError
    if row.result_set_id is not None:
        raise ResultAlreadyImportedError
    if row.job_id is not None:
        status = await connection.scalar(select(jobs.c.status).where(jobs.c.id == row.job_id))
        if status in {JobStatus.FAILED, JobStatus.CANCELLING, JobStatus.CANCELLED}:
            raise ResultImportEndedError
        if status == JobStatus.DONE:
            raise ResultAlreadyImportedError
        raise ResultImportStartedError
    return row


@router.put(
    "/{upload_id}/slide",
    operation_id="pairUploadWithSlide",
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def pair_upload_with_slide(
    upload_id: UploadId,
    choice: SlideChoice,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> UploadState:
    await lock_slide_upload(connection, choice.slide_upload_id)
    row = await overridable(connection, principal, upload_id)
    targets = await target_values(
        connection, principal, row.project_id, choice.slide_id, choice.slide_upload_id
    )
    changed = (
        await connection.execute(
            update(uploads)
            .where(uploads.c.id == row.id)
            .values(
                slide_id=targets.get("slide_id"),
                slide_upload_id=targets.get("slide_upload_id"),
                pairing_rule=Rule.PICKED,
                pairing_certainty=Certainty.SURE,
            )
            .returning(uploads)
        )
    ).one()
    await queue_if_ready(connection, changed)
    await record(
        connection,
        actor_of(principal),
        AuditAction.UPLOAD_PAIRED,
        AuditTarget.UPLOAD,
        row.id,
        tenant_id=row.tenant_id,
        details={
            "project_id": str(row.project_id),
            "slide_id": str(targets["slide_id"]) if targets.get("slide_id") else None,
            "slide_upload_id": (
                str(choice.slide_upload_id) if choice.slide_upload_id is not None else None
            ),
        },
    )
    current = (await connection.execute(select(uploads).where(uploads.c.id == row.id))).one()
    return await state_of(connection, current)
