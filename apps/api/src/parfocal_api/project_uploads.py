import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.notifications import member_of
from parfocal_api.permissions import Permission, require
from parfocal_api.project_overview import BYTES_PER_GB, whole_project
from parfocal_api.tables import UploadStatus, cases, slides, uploads
from parfocal_common.result_imports import UploadKind

ARRIVALS = 20
BATCH_WINDOW = timedelta(hours=24)
BATCH_SIZE = 200
MIN_SIZE_GB = 0.001


class WatchedFolder(BaseModel):
    address: str
    slides: str
    results: str
    every: str
    on: bool


class WebhookAbility(BaseModel):
    label: str
    on: bool


class ImportWebhook(BaseModel):
    url: str
    secret_end: str
    abilities: list[WebhookAbility]
    on: bool


class OutgoingEvent(BaseModel):
    name: str
    text: str
    on: bool


class EventsOut(BaseModel):
    endpoint: str
    last_call: int
    events: list[OutgoingEvent]
    on: bool


class TokenEnd(BaseModel):
    end: str


class LastArrival(BaseModel):
    at: str
    what: str


class Arrival(BaseModel):
    at: str
    event: str
    file: str
    code: int
    result: str


class ProjectImports(BaseModel):
    project_id: uuid.UUID
    watched_folder: WatchedFolder
    webhook: ImportWebhook
    events_out: EventsOut
    token: TokenEnd
    last_arrival: LastArrival | None
    arrivals: list[Arrival]


class BatchStep(BaseModel):
    label: str
    detail: str


class RunningStep(BaseModel):
    percent: float
    text: str


class BatchProgress(BaseModel):
    percent: float = Field(ge=0, le=100)
    tone: Literal["ok", "tiles", "accent"]
    text: str


class ExtraResult(BaseModel):
    name: str
    detail: str


class BatchFailure(BaseModel):
    reason: str
    message: str
    failure_class: Literal["transient", "permanent"]


class UploadBatchSlide(BaseModel):
    name: str
    format: str
    size_gb: float = Field(gt=0)
    case_label: str | None
    steps: list[BatchStep]
    steps_done: int = Field(ge=0)
    running: RunningStep | None
    progress: BatchProgress
    extra_result: ExtraResult
    failure: BatchFailure | None = None


class Pairing(BaseModel):
    slide: int | None = Field(ge=0)
    how: str
    warn: str | None


class Pairings(BaseModel):
    auto: Pairing
    name: Pairing
    id: Pairing


class UploadBatchResult(BaseModel):
    name: str
    detail: str
    pairings: Pairings


class ProblemLine(BaseModel):
    line: str
    object: str
    error: str


class UploadProblem(BaseModel):
    kind: Literal["read-error", "scale", "new-classes"]
    result: int = Field(ge=0)
    title: str
    text: str
    lines: list[ProblemLine]
    fix: str
    fixed: str


class FolderEntry(BaseModel):
    name: str
    note: str
    depth: float


class NewClass(BaseModel):
    name: str
    cells: float
    to: str | None


class Duplicate(BaseModel):
    slide: int = Field(ge=0)
    uploaded_on: str


class BatchStorage(BaseModel):
    needed_gb: float
    left_gb: float
    allowance_gb: float
    trimmed_gb: float
    trimmed_slides: int


class SourceOutage(BaseModel):
    source: str
    at: str
    waiting: int


class BatchDone(BaseModel):
    minutes: int
    first_ids: str


class ResultPreview(BaseModel):
    slide_label: str
    case_label: str
    beside: str
    file: str
    detail: str
    model: str
    version: str
    checks: list[str]
    level: int
    scale: float
    shift: tuple[float, float]


class FormatFinding(BaseModel):
    tone: Literal["ok", "warn"]
    text: str


class FormatCheck(BaseModel):
    file: str
    detail: str
    findings: list[FormatFinding]


class UploadBatch(BaseModel):
    project_id: uuid.UUID
    slides: list[UploadBatchSlide]
    results: list[UploadBatchResult]
    folder_tree: list[FolderEntry]
    problems: list[UploadProblem]
    new_classes: list[NewClass]
    unscored_rows: int = Field(ge=0)
    duplicate: Duplicate
    storage: BatchStorage
    source_outage: SourceOutage
    done: BatchDone
    result_preview: ResultPreview
    format_check: FormatCheck


router = APIRouter(prefix="/api/projects/{project_id}", tags=["uploads"])

ENDED = {UploadStatus.ABORTED, UploadStatus.EXPIRED}


def arrival_of(row: Any) -> Arrival:
    status = UploadStatus(row.status)
    return Arrival(
        at=row.created_at.isoformat(),
        event=f"{row.kind}.{status.value}",
        file=row.file_name,
        code=410 if status in ENDED else 201,
        result=status.value,
    )


@router.get(
    "/imports",
    operation_id="getProjectImports",
    **require(Permission.UPLOAD_SLIDES),
)
async def get_project_imports(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> ProjectImports:
    await whole_project(connection, principal, project_id)
    rows = (
        await connection.execute(
            select(
                uploads.c.kind,
                uploads.c.status,
                uploads.c.file_name,
                uploads.c.created_at,
            )
            .where(uploads.c.project_id == project_id)
            .order_by(uploads.c.created_at.desc(), uploads.c.id)
            .limit(ARRIVALS)
        )
    ).all()
    arrivals = [arrival_of(row) for row in rows]
    return ProjectImports(
        project_id=project_id,
        watched_folder=WatchedFolder(address="", slides="", results="", every="", on=False),
        webhook=ImportWebhook(url="", secret_end="", abilities=[], on=False),
        events_out=EventsOut(endpoint="", last_call=0, events=[], on=False),
        token=TokenEnd(end=""),
        last_arrival=(
            None if not arrivals else LastArrival(at=arrivals[0].at, what=arrivals[0].file)
        ),
        arrivals=arrivals,
    )


def progress_of(row: Any) -> BatchProgress:
    status = UploadStatus(row.status)
    if status is UploadStatus.COMPLETED and row.published_at is not None:
        return BatchProgress(percent=100, tone="ok", text="Ready")
    if status is UploadStatus.COMPLETED:
        return BatchProgress(percent=100, tone="tiles", text="Uploaded")
    if status in ENDED:
        return BatchProgress(percent=0, tone="accent", text=status.value.capitalize())
    return BatchProgress(percent=0, tone="accent", text="Uploading")


def failure_of(row: Any) -> BatchFailure | None:
    status = UploadStatus(row.status)
    if status not in ENDED:
        return None
    return BatchFailure(
        reason=status.value,
        message=f"The upload of {row.file_name} was {status.value}",
        failure_class="transient",
    )


def format_of(row: Any) -> str:
    if row.format:
        return str(row.format)
    _, dot, extension = row.file_name.rpartition(".")
    return extension.lower() if dot else ""


def pairing_of(slide: int | None, rule: str | None, certainty: str | None) -> Pairing:
    return Pairing(
        slide=slide,
        how=rule or "",
        warn=None if certainty in (None, "sure") else certainty,
    )


EMPTY_PAIRING = Pairing(slide=None, how="", warn=None)


@router.get(
    "/upload-batch",
    operation_id="getUploadBatch",
    **require(Permission.UPLOAD_SLIDES),
)
async def get_upload_batch(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> UploadBatch:
    member = member_of(principal)
    await whole_project(connection, principal, project_id)
    since = datetime.now(UTC) - BATCH_WINDOW
    rows = (
        await connection.execute(
            select(
                uploads.c.id,
                uploads.c.kind,
                uploads.c.status,
                uploads.c.file_name,
                uploads.c.size_bytes,
                uploads.c.result_format,
                uploads.c.slide_upload_id,
                uploads.c.pairing_rule,
                uploads.c.pairing_certainty,
                slides.c.format,
                slides.c.published_at,
                cases.c.label.label("case_label"),
            )
            .outerjoin(slides, slides.c.upload_id == uploads.c.id)
            .outerjoin(cases, cases.c.id == uploads.c.case_id)
            .where(
                uploads.c.project_id == project_id,
                uploads.c.created_by_user_id == member.user_id,
                uploads.c.created_at >= since,
            )
            .order_by(uploads.c.created_at, uploads.c.id)
            .limit(BATCH_SIZE)
        )
    ).all()
    slide_rows = [row for row in rows if row.kind == UploadKind.SLIDE]
    index_of = {row.id: index for index, row in enumerate(slide_rows)}
    open_bytes = sum(
        row.size_bytes for row in slide_rows if UploadStatus(row.status) is UploadStatus.OPEN
    )
    return UploadBatch(
        project_id=project_id,
        slides=[
            UploadBatchSlide(
                name=row.file_name,
                format=format_of(row),
                size_gb=max(MIN_SIZE_GB, round(row.size_bytes / BYTES_PER_GB, 3)),
                case_label=row.case_label,
                steps=[],
                steps_done=0,
                running=None,
                progress=progress_of(row),
                extra_result=ExtraResult(name="", detail=""),
                failure=failure_of(row),
            )
            for row in slide_rows
        ],
        results=[
            UploadBatchResult(
                name=row.file_name,
                detail=row.result_format or "",
                pairings=Pairings(
                    auto=pairing_of(
                        index_of.get(row.slide_upload_id),
                        row.pairing_rule,
                        row.pairing_certainty,
                    ),
                    name=EMPTY_PAIRING,
                    id=EMPTY_PAIRING,
                ),
            )
            for row in rows
            if row.kind == UploadKind.RESULT
        ],
        folder_tree=[],
        problems=[],
        new_classes=[],
        unscored_rows=0,
        duplicate=Duplicate(slide=0, uploaded_on=""),
        storage=BatchStorage(
            needed_gb=round(open_bytes / BYTES_PER_GB, 3),
            left_gb=0,
            allowance_gb=0,
            trimmed_gb=0,
            trimmed_slides=0,
        ),
        source_outage=SourceOutage(source="", at="", waiting=0),
        done=BatchDone(minutes=0, first_ids=""),
        result_preview=ResultPreview(
            slide_label="",
            case_label="",
            beside="",
            file="",
            detail="",
            model="",
            version="",
            checks=[],
            level=0,
            scale=1,
            shift=(0, 0),
        ),
        format_check=FormatCheck(file="", detail="", findings=[]),
    )
