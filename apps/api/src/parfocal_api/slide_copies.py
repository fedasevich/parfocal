import uuid
from pathlib import PurePosixPath
from typing import Annotated, Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.audit_trail import keyring_of
from parfocal_api.case_creation import privacy_of, require_owner
from parfocal_api.context import CurrentPrincipal, Store, TenantConnection
from parfocal_api.deidentified import case_pseudonym
from parfocal_api.identifiers import TenantKeys, ensure_keys
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal, database_scope
from parfocal_api.problems import BadRequestError, NotFoundError
from parfocal_api.slide_ingest import free_label, taken_labels
from parfocal_api.tables import CaseSource, PrivacyMode, cases, projects, slides
from parfocal_common.ingest import slide_prefix
from parfocal_common.object_store import ObjectStore

MAX_COPIES = 20
COPY_PART_BYTES = 1024**3
COPIED_LABEL = "Slide"

router = APIRouter(prefix="/api/projects/{project_id}/slide-copies", tags=["slides"])


class SlideCopyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slide_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=MAX_COPIES)]


class SlideCopy(BaseModel):
    source_slide_id: uuid.UUID
    slide_id: uuid.UUID
    case_id: uuid.UUID | None
    case_label: str | None


class SlideCopies(BaseModel):
    copies: list[SlideCopy]


class CopyNeedsDeIdentifiedProjectError(BadRequestError):
    code = "copy-needs-de-identified-project"
    title = "Slides are copied only into a de-identified project"


class SameProjectError(BadRequestError):
    code = "copy-within-project"
    title = "A slide is copied only into another project"


class SlideNotReadyError(BadRequestError):
    code = "slide-not-ready"
    title = "Only a slide that finished processing can be copied"


async def source_of(
    connection: AsyncConnection, principal: Principal, slide_id: uuid.UUID, target: uuid.UUID
) -> Any:
    row = (
        await connection.execute(
            select(slides)
            .join(projects, projects.c.id == slides.c.project_id)
            .where(
                slides.c.id == slide_id,
                slides.c.deleted_at.is_(None),
                projects.c.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Slide not found")
    await require_owner(connection, principal, row.project_id)
    if row.project_id == target:
        raise SameProjectError
    if row.original_key is None or row.published_at is None:
        raise SlideNotReadyError
    return row


async def pseudonymous_case(
    connection: AsyncConnection,
    keys: TenantKeys,
    principal: Principal,
    project_id: uuid.UUID,
    source_case_id: uuid.UUID,
) -> tuple[uuid.UUID, str]:
    label = case_pseudonym(keys, project_id, source_case_id)
    found = await connection.scalar(
        select(cases.c.id).where(
            cases.c.project_id == project_id, cases.c.label == label, cases.c.deleted_at.is_(None)
        )
    )
    if found is not None:
        return found, label
    case_id = uuid.uuid4()
    tenant_id = keys.tenant_id
    await connection.execute(
        insert(cases).values(
            id=case_id,
            tenant_id=tenant_id,
            project_id=project_id,
            label=label,
            source=CaseSource.COPY,
            created_by_user_id=(
                principal.user_id if isinstance(principal, MemberPrincipal) else None
            ),
        )
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.CASE_CREATED,
        AuditTarget.CASE,
        case_id,
        tenant_id=tenant_id,
        details={"source": CaseSource.COPY, "privacy_mode": PrivacyMode.DE_IDENTIFIED},
    )
    return case_id, label


async def copy_files(
    store: ObjectStore, tenant_id: uuid.UUID, source: Any, slide_id: uuid.UUID
) -> str:
    source_prefix = slide_prefix(tenant_id, source.id)
    target_prefix = slide_prefix(tenant_id, slide_id)
    for key in await store.list_keys(source_prefix):
        size = await store.head_object(key)
        if not size:
            continue
        await store.copy_object(
            key, f"{target_prefix}{key.removeprefix(source_prefix)}", size, COPY_PART_BYTES
        )
    original: str = source.original_key
    if original.startswith(source_prefix):
        return f"{target_prefix}{PurePosixPath(original).name}"
    return original


async def copy_one(
    connection: AsyncConnection,
    store: ObjectStore,
    keys: TenantKeys,
    principal: Principal,
    project_id: uuid.UUID,
    source: Any,
) -> SlideCopy:
    case_id: uuid.UUID | None = None
    case_label: str | None = None
    if source.case_id is not None:
        case_id, case_label = await pseudonymous_case(
            connection, keys, principal, project_id, source.case_id
        )
    slide_id = uuid.uuid4()
    original_key = await copy_files(store, keys.tenant_id, source, slide_id)
    label = free_label(
        COPIED_LABEL, await taken_labels(connection, project_id, case_id, COPIED_LABEL)
    )
    await connection.execute(
        insert(slides).values(
            id=slide_id,
            tenant_id=keys.tenant_id,
            project_id=project_id,
            case_id=case_id,
            label=label,
            stain=source.stain,
            format=source.format,
            variant=source.variant,
            reader=source.reader,
            width=source.width,
            height=source.height,
            level_count=source.level_count,
            mpp_x=source.mpp_x,
            mpp_y=source.mpp_y,
            objective_power=source.objective_power,
            notices=list(source.notices),
            file_bytes=source.file_bytes,
            sha256=source.sha256,
            original_key=original_key,
            restricted_images=[],
            published_at=func.now(),
        )
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.SLIDE_COPIED,
        AuditTarget.SLIDE,
        slide_id,
        tenant_id=keys.tenant_id,
        details={
            "from_slide_id": str(source.id),
            "from_project_id": str(source.project_id),
            "to_project_id": str(project_id),
            "case_id": str(case_id) if case_id else None,
        },
    )
    return SlideCopy(
        source_slide_id=source.id, slide_id=slide_id, case_id=case_id, case_label=case_label
    )


@router.post("", operation_id="copySlides", **require(Permission.CREATE_CASES, write=True))
async def copy_slides(
    project_id: uuid.UUID,
    request: SlideCopyRequest,
    http: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    store: Store,
) -> SlideCopies:
    mode = await privacy_of(connection, project_id)
    await require_owner(connection, principal, project_id)
    if mode is not PrivacyMode.DE_IDENTIFIED:
        raise CopyNeedsDeIdentifiedProjectError
    chosen = list(dict.fromkeys(request.slide_ids))
    sources = [await source_of(connection, principal, slide_id, project_id) for slide_id in chosen]
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    keys = await ensure_keys(connection, keyring_of(http), tenant_id)
    copies = [
        await copy_one(connection, store, keys, principal, project_id, source) for source in sources
    ]
    return SlideCopies(copies=copies)
