import csv
import io
import uuid
from typing import Annotated, Any, cast

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import ConflictError
from parfocal_api.result_pairing import (
    NotAResultUploadError,
    ResultAlreadyImportedError,
    ResultImportEndedError,
    ResultImportStartedError,
)
from parfocal_api.result_sets import require_uploading
from parfocal_api.tables import UploadStatus, jobs, project_classes, projects, uploads
from parfocal_api.taxonomy import (
    ClassMapping,
    MappingChange,
    UnknownClassError,
    remember_class_mappings,
)
from parfocal_api.uploads import (
    UploadId,
    UploadNotFoundError,
    UploadState,
    audit,
    created_by,
    state_of,
)
from parfocal_common.jobs import JobStatus
from parfocal_common.result_imports import (
    CHECK_PROBLEMS,
    ScoreDefault,
    UploadKind,
    enqueue_result_import,
)

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

REPORT_NAME = "import-problems.csv"


class HeatmapGuess(BaseModel):
    level: int | None
    downsample: float
    mpp: float | None


class ImportProblem(BaseModel):
    code: str
    message: str
    count: int
    places: list[str]
    names: list[str]
    guess: HeatmapGuess | None


class ImportCheck(BaseModel):
    upload_id: uuid.UUID
    readable: int | None
    problems: list[ImportProblem]


class ImportChoices(BaseModel):
    score_default: ScoreDefault = ScoreDefault.NONE
    unclassified_class_id: uuid.UUID | None = None
    class_mappings: Annotated[list[ClassMapping], Field(max_length=200)] = Field(
        default_factory=list[ClassMapping]
    )


class NothingToChooseError(ConflictError):
    code = "result-has-no-problems"
    title = "This result has no problems waiting for a choice"


async def own_upload(
    connection: AsyncConnection, principal: Principal, upload_id: uuid.UUID
) -> Any:
    row = (
        await connection.execute(
            select(uploads).where(uploads.c.id == upload_id, created_by(principal))
        )
    ).one_or_none()
    if row is None:
        raise UploadNotFoundError
    return row


async def own_result(
    connection: AsyncConnection, principal: Principal, upload_id: uuid.UUID
) -> Any:
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
    if row.kind != UploadKind.RESULT:
        raise NotAResultUploadError
    return row


def problems_of(row: Any) -> ImportCheck:
    stored = cast("dict[str, Any]", row.import_problems or {})
    found = cast("list[dict[str, Any]]", stored.get("problems") or [])
    return ImportCheck(
        upload_id=row.id,
        readable=stored.get("readable"),
        problems=[
            ImportProblem(
                code=item["code"],
                message=CHECK_PROBLEMS.get(item["code"], item["code"]),
                count=item.get("count", 0),
                places=item.get("places") or [],
                names=item.get("names") or [],
                guess=item.get("guess"),
            )
            for item in found
        ],
    )


@router.get(
    "/{upload_id}/problems",
    operation_id="getImportProblems",
    **require(Permission.UPLOAD_SLIDES),
)
async def get_import_problems(
    upload_id: UploadId, principal: CurrentPrincipal, connection: TenantConnection
) -> ImportCheck:
    return problems_of(await own_upload(connection, principal, upload_id))


@router.get(
    "/{upload_id}/problems/report",
    operation_id="downloadImportProblems",
    response_class=Response,
    responses={
        200: {
            "description": "Every problem and where it is, as CSV",
            "content": {"text/csv": {"schema": {"type": "string"}}},
        }
    },
    **require(Permission.UPLOAD_SLIDES),
)
async def download_import_problems(
    upload_id: UploadId, principal: CurrentPrincipal, connection: TenantConnection
) -> Response:
    check = problems_of(await own_upload(connection, principal, upload_id))
    text = io.StringIO()
    writer = csv.writer(text)
    writer.writerow(["upload", "problem", "place", "message"])
    for item in check.problems:
        places = item.places or item.names or [""]
        writer.writerows([check.upload_id, item.code, place, item.message] for place in places)
    return Response(
        content=text.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{REPORT_NAME}"'},
    )


async def waiting_for_choices(connection: AsyncConnection, row: Any) -> None:
    if row.status != UploadStatus.COMPLETED:
        raise ResultImportEndedError
    if row.result_set_id is not None:
        raise ResultAlreadyImportedError
    status = await connection.scalar(select(jobs.c.status).where(jobs.c.id == row.job_id))
    if status in {JobStatus.FAILED, JobStatus.CANCELLING, JobStatus.CANCELLED}:
        raise ResultImportEndedError
    if row.import_choices is not None or status in {JobStatus.QUEUED, JobStatus.RUNNING}:
        raise ResultImportStartedError
    if row.import_problems is None:
        raise NothingToChooseError


async def project_class(
    connection: AsyncConnection, project_id: uuid.UUID, class_id: uuid.UUID | None
) -> None:
    if class_id is None:
        return
    found = await connection.scalar(
        select(project_classes.c.id).where(
            project_classes.c.id == class_id, project_classes.c.project_id == project_id
        )
    )
    if found is None:
        raise UnknownClassError


@router.put(
    "/{upload_id}/import-choices",
    operation_id="chooseHowToImport",
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def choose_how_to_import(
    upload_id: UploadId,
    choices: ImportChoices,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> UploadState:
    row = await own_result(connection, principal, upload_id)
    await require_uploading(connection, principal, row.project_id, row.archived_at is not None)
    await waiting_for_choices(connection, row)
    await project_class(connection, row.project_id, choices.unclassified_class_id)
    if choices.class_mappings:
        await remember_class_mappings(
            row.project_id, MappingChange(mappings=choices.class_mappings), principal, connection
        )
    job_id = await enqueue_result_import(connection, row.tenant_id, row.project_id, row.id)
    await connection.execute(
        update(uploads)
        .where(uploads.c.id == row.id)
        .values(
            job_id=job_id,
            import_choices=choices.model_dump(mode="json", exclude={"class_mappings"}),
        )
    )
    current = (await connection.execute(select(uploads).where(uploads.c.id == row.id))).one()
    return await state_of(connection, current)


@router.post(
    "/{upload_id}/leave-out",
    operation_id="leaveResultOut",
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def leave_result_out(
    upload_id: UploadId,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
) -> UploadState:
    row = await own_result(connection, principal, upload_id)
    await require_uploading(connection, principal, row.project_id, row.archived_at is not None)
    if row.status != UploadStatus.COMPLETED:
        raise ResultImportEndedError
    if row.result_set_id is not None:
        raise ResultAlreadyImportedError
    if row.job_id is not None:
        await waiting_for_choices(connection, row)
    await connection.execute(
        update(uploads)
        .where(uploads.c.id == row.id)
        .values(status=UploadStatus.ABORTED, job_id=None, closed_at=func.now())
    )
    await store.delete_object(row.object_key)
    await audit(connection, principal, AuditAction.UPLOAD_ABORTED, row)
    current = (await connection.execute(select(uploads).where(uploads.c.id == row.id))).one()
    return await state_of(connection, current)
