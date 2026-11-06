import json
import uuid
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Path, Query
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction
from parfocal_api.case_sorting import SlideOutcome, SortedFile, SortingRequest, draft_of
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import BadRequestError
from parfocal_api.tables import uploads
from parfocal_api.uploads import Settings, audit, creator_values, object_key
from parfocal_common.link_fetch import (
    LINK_FAILURES,
    LinkRefusal,
    LinkRefusedError,
    link_client,
    policy_of,
)
from parfocal_common.link_imports import enqueue_link_fetch, source_key
from parfocal_common.link_listing import LinkedFile, list_link
from parfocal_common.pairing import Certainty, FileKind, Outcome, kind_of
from parfocal_common.part_plan import part_size_for, plan_parts
from parfocal_common.result_imports import UploadKind, can_sniff, format_of

GIB = 1024**3
MAX_ADDRESS = 2048

type Address = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_ADDRESS)
]
type ProjectId = Annotated[uuid.UUID, Path()]

router = APIRouter(prefix="/api/projects", tags=["uploads"])


class LinkNotFetchedError(BadRequestError):
    code = "link-refused"
    title = "Parfocal will not fetch this link"


class NothingChosenError(BadRequestError):
    code = "nothing-chosen"
    title = "None of the chosen files can be imported from this link"


class SourceResult(BaseModel):
    name: str
    detail: str


class SourceCase(BaseModel):
    label: str
    case_id: uuid.UUID | None


class SourceFile(BaseModel):
    name: str
    detail: str
    size_gb: float
    size_bytes: int | None
    in_project: bool
    case: SourceCase | None
    refused: LinkRefusal | None
    message: str | None
    result: SourceResult | None


class SourceListing(BaseModel):
    address: str
    kind: Literal["link", "storage"]
    files: list[SourceFile]
    others: list[str]


class LinkImportRequest(BaseModel):
    address: Address
    names: Annotated[list[Annotated[str, StringConstraints(max_length=255)]], Field(min_length=1)]


class StartedFile(BaseModel):
    name: str
    upload_id: uuid.UUID
    kind: UploadKind
    job_id: uuid.UUID


class LinkImport(BaseModel):
    started: list[StartedFile]
    left_out: list[str]


@dataclass(frozen=True)
class Planned:
    file: LinkedFile
    kind: UploadKind
    case_id: uuid.UUID | None = None
    paired_with: str | None = None
    certainty: Certainty | None = None
    rule: str | None = None


def size_text(size: int | None) -> str:
    if size is None:
        return "size unknown"
    if size >= GIB:
        return f"{size / GIB:.1f} GB"
    return f"{max(size / 1024**2, 0.1):.1f} MB"


def refusal_of(file: LinkedFile, settings: Settings) -> LinkRefusal | None:
    if file.size is None:
        return LinkRefusal.SIZE_UNKNOWN
    if file.size > settings.upload_max_bytes or file.size < 1:
        return LinkRefusal.TOO_LARGE
    return None


def kind_of_file(name: str) -> FileKind:
    kind = kind_of(name)
    if kind is FileKind.RESULT and format_of(name) is None and not can_sniff(name):
        return FileKind.OTHER
    return kind


async def files_at(settings: Settings, address: str) -> list[LinkedFile]:
    policy = policy_of(settings.link_trusted_origins)
    try:
        async with link_client(settings.link_read_seconds) as client:
            found = await list_link(client, address, policy)
    except LinkRefusedError as error:
        raise LinkNotFetchedError(LINK_FAILURES[error.code]) from error
    unique: dict[str, LinkedFile] = {}
    for file in found:
        unique.setdefault(file.name, file)
    return list(unique.values())


@dataclass(frozen=True)
class Look:
    files: list[LinkedFile]
    request: SortingRequest
    draft: Any


async def look(
    connection: AsyncConnection,
    principal: Principal,
    settings: Settings,
    project_id: uuid.UUID,
    address: str,
) -> Look:
    found = await files_at(settings, address)
    kinds = {file.name: kind_of_file(file.name) for file in found}
    request = SortingRequest(
        project_id=project_id,
        files=[
            SortedFile(path=file.name, kind=kinds[file.name], size=file.size or None)
            for file in found
        ]
        or [SortedFile(path="empty", kind=FileKind.OTHER)],
    )
    return Look(found, request, await draft_of(connection, principal, request))


def paired_results(draft: Any) -> dict[str, list[Any]]:
    paired: dict[str, list[Any]] = {}
    for pairing in draft.results:
        slide = pairing.slide.path if pairing.slide is not None else None
        if pairing.outcome is Outcome.PAIRED and slide is not None:
            paired.setdefault(slide, []).append(pairing)
    return paired


def source_files(look: Look, settings: Settings) -> list[SourceFile]:
    by_name = {file.name: file for file in look.files}
    paired = paired_results(look.draft)
    listed: list[SourceFile] = []
    for entry in look.draft.slides:
        file = by_name[entry.path]
        refused = refusal_of(file, settings)
        first = next(iter(paired.get(entry.path, [])), None)
        result_file = by_name.get(first.path) if first is not None else None
        listed.append(
            SourceFile(
                name=file.name,
                detail=size_text(file.size),
                size_gb=max(file.size or 1, 1) / GIB,
                size_bytes=file.size,
                in_project=entry.outcome is SlideOutcome.LEFT_OUT,
                case=SourceCase(label=entry.case.label, case_id=entry.case.case_id)
                if entry.case is not None
                else None,
                refused=refused,
                message=LINK_FAILURES[refused] if refused is not None else None,
                result=SourceResult(name=result_file.name, detail=size_text(result_file.size))
                if result_file is not None
                else None,
            )
        )
    return listed


@router.get(
    "/{project_id}/source-files",
    operation_id="listSourceFiles",
    **require(Permission.UPLOAD_SLIDES),
)
async def list_source_files(
    project_id: ProjectId,
    address: Annotated[str, Query(min_length=1, max_length=MAX_ADDRESS)],
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
) -> SourceListing:
    found = await look(connection, principal, settings, project_id, address)
    return SourceListing(
        address=address,
        kind="link",
        files=source_files(found, settings),
        others=found.draft.others,
    )


def planned_files(look: Look, settings: Settings, names: set[str]) -> list[Planned]:
    by_name = {file.name: file for file in look.files}
    paired = paired_results(look.draft)
    planned: list[Planned] = []
    for entry in look.draft.slides:
        file = by_name[entry.path]
        if entry.path not in names or entry.outcome is SlideOutcome.LEFT_OUT:
            continue
        if refusal_of(file, settings) is not None:
            continue
        case_id = entry.case.case_id if entry.case is not None else None
        planned.append(Planned(file, UploadKind.SLIDE, case_id))
        for pairing in paired.get(entry.path, []):
            result = by_name[pairing.path]
            if refusal_of(result, settings) is None:
                planned.append(
                    Planned(
                        result,
                        UploadKind.RESULT,
                        case_id,
                        entry.path,
                        pairing.certainty,
                        pairing.rule,
                    )
                )
    return planned


async def start_file(
    connection: AsyncConnection,
    principal: Principal,
    settings: Settings,
    store: Store,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    planned: Planned,
    slide_uploads: dict[str, uuid.UUID],
) -> StartedFile:
    file = planned.file
    size = file.size or 0
    plan = plan_parts(size, part_size_for(size, settings.upload_part_bytes))
    upload_id = uuid.uuid4()
    key = object_key(tenant_id, upload_id, file.name)
    storage_upload_id = await store.create_multipart_upload(key)
    result: dict[str, Any] = {}
    if planned.kind is UploadKind.RESULT and planned.paired_with is not None:
        result = {
            "kind": UploadKind.RESULT,
            "result_format": format_of(file.name),
            "slide_upload_id": slide_uploads[planned.paired_with],
            "pairing_rule": planned.rule,
            "pairing_certainty": planned.certainty,
        }
    row = (
        await connection.execute(
            insert(uploads)
            .values(
                id=upload_id,
                tenant_id=tenant_id,
                project_id=project_id,
                case_id=planned.case_id,
                file_name=file.name,
                size_bytes=size,
                object_key=key,
                storage_upload_id=storage_upload_id,
                part_bytes=plan.part_bytes,
                part_count=plan.part_count,
                **result,
                **creator_values(principal),
            )
            .returning(uploads)
        )
    ).one()
    source = json.dumps({"address": file.url}).encode()
    await store.put_object(source_key(tenant_id, upload_id), source, "application/json")
    job_id = await enqueue_link_fetch(connection, tenant_id, project_id, upload_id)
    await audit(connection, principal, AuditAction.UPLOAD_LINKED, row)
    if planned.kind is UploadKind.SLIDE:
        slide_uploads[file.name] = upload_id
    return StartedFile(name=file.name, upload_id=upload_id, kind=planned.kind, job_id=job_id)


@router.post(
    "/{project_id}/link-imports",
    operation_id="importFromLink",
    status_code=202,
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def import_from_link(
    project_id: ProjectId,
    request: LinkImportRequest,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
    store: Store,
) -> LinkImport:
    found = await look(connection, principal, settings, project_id, request.address)
    names = set(request.names)
    planned = planned_files(found, settings, names)
    if not planned:
        raise NothingChosenError
    slide_uploads: dict[str, uuid.UUID] = {}
    started = [
        await start_file(
            connection,
            principal,
            settings,
            store,
            found.draft.tenant_id,
            found.draft.project_id,
            item,
            slide_uploads,
        )
        for item in planned
    ]
    left_out = sorted(
        entry.path
        for entry in found.draft.slides
        if entry.path in names and entry.path not in slide_uploads
    )
    return LinkImport(started=started, left_out=left_out)
