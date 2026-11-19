import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any, cast

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, pseudonym_of
from parfocal_api.blinding import ai_hidden, sees_whole
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.my_work import describe
from parfocal_api.notifications import deliver_after_commit, member_of, notify
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import ConflictError, NotFoundError
from parfocal_api.project_access import readable_slide, role_in
from parfocal_api.projects import audit, row_of, visible
from parfocal_api.review_order import tile
from parfocal_api.review_states import State
from parfocal_api.review_tasks import code_of as task_code
from parfocal_api.tables import (
    AnnotationKind,
    NotificationKind,
    PrivacyMode,
    ProjectRole,
    ResultObjectKind,
    ResultStatus,
    annotations,
    audit_events,
    cases,
    project_classes,
    project_members,
    projects,
    result_chunks,
    result_objects,
    result_sets,
    review_tasks,
    slides,
    specimens,
    uploads,
)
from parfocal_common.result_imports import CHECK_PROBLEMS, UploadKind

BYTES_PER_GB = 1_000_000_000
DEFAULT_DUE_DAYS = 14
DEFAULT_REMINDER_DAYS = [2, 1]
REVIEWED = {State.SUBMITTED, State.DISAGREEMENT_QUEUE, State.SIGNED_OFF, State.EXPORTED}
NEEDS_REVIEW = {State.IMPORTED, State.READY, State.ASSIGNED, State.IN_REVIEW}


class CaseGroup(BaseModel):
    label: str
    specimen: str
    slide_count: int = Field(ge=0)


class SlideFile(BaseModel):
    slide_id: uuid.UUID
    file: str
    stain: str
    remote: str | None


class ProjectStorage(BaseModel):
    used_gb: float = Field(ge=0)
    allowance_gb: float | None = Field(gt=0)


class ImportFailure(BaseModel):
    file: str
    slide_label: str
    objects: int = Field(gt=0)
    reason: str


class ProjectOverview(BaseModel):
    project_id: uuid.UUID
    cases: int = Field(ge=0)
    slides: int = Field(ge=0)
    result_sets: int = Field(ge=0)
    objects: int = Field(ge=0)
    reviewed_percent: float = Field(ge=0, le=100)
    needs_review: int = Field(ge=0)
    no_results: int = Field(ge=0)
    case_groups: list[CaseGroup]
    slide_files: list[SlideFile]
    study_template_id: uuid.UUID | None
    storage: ProjectStorage
    import_failure: ImportFailure | None


class SlideCase(BaseModel):
    id: uuid.UUID
    label: str
    specimen: str


class ProjectSlide(BaseModel):
    id: uuid.UUID
    label: str
    stain: str
    case: SlideCase | None
    result_set_ids: list[uuid.UUID]


class ScopeRoi(BaseModel):
    key: str
    name: str


class UnsureZone(BaseModel):
    key: str
    cells_per_slide: int = Field(ge=0)


class ProjectScopeOptions(BaseModel):
    rois: list[ScopeRoi]
    unsure_zones: list[UnsureZone]


class SetName(BaseModel):
    result_set_id: uuid.UUID
    name: str


class ReviewTaskDefaults(BaseModel):
    code: str
    task_id: uuid.UUID
    names: list[SetName]
    slide_ids: list[uuid.UUID]
    result_set_id: str
    reviewer_ids: list[uuid.UUID]
    due_on: date
    reminder_days: list[int]
    study_template_id: str
    today: date


class ProjectAccessRequest(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    user_id: uuid.UUID
    owner_id: uuid.UUID
    asked_at: datetime


class AlreadyInProjectError(ConflictError):
    code = "already-in-project"
    title = "You are already in this project"


class ProjectWithoutOwnerError(ConflictError):
    code = "project-without-owner"
    title = "This project has no owner to ask"


router = APIRouter(prefix="/api/projects/{project_id}", tags=["projects"])


async def whole_project(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID
) -> Any:
    row = await visible(connection, principal, project_id)
    if not await sees_whole(connection, principal, project_id):
        raise NotFoundError("Project not found")
    return row


def live_slides(project_id: uuid.UUID) -> Any:
    return and_(slides.c.project_id == project_id, slides.c.deleted_at.is_(None))


def live_sets(project_id: uuid.UUID) -> Any:
    return and_(result_sets.c.project_id == project_id, result_sets.c.deleted_at.is_(None))


async def first_specimens(connection: AsyncConnection, project_id: uuid.UUID) -> dict[Any, str]:
    rows = await connection.execute(
        select(cases.c.id, specimens.c.type)
        .join(specimens, specimens.c.case_id == cases.c.id)
        .where(cases.c.project_id == project_id, cases.c.deleted_at.is_(None))
        .order_by(cases.c.id, specimens.c.letter)
    )
    found: dict[Any, str] = {}
    for row in rows:
        found.setdefault(row.id, row.type or "")
    return found


async def slide_states(connection: AsyncConnection, project_id: uuid.UUID) -> list[State]:
    rows = (
        await connection.execute(
            select(
                slides.c.id,
                slides.c.label,
                slides.c.case_id,
                slides.c.created_at,
                slides.c.storage,
                slides.c.notices,
                slides.c.project_id,
                projects.c.number.label("project_number"),
                projects.c.name.label("project_name"),
                cases.c.label.label("case_label"),
            )
            .join(projects, projects.c.id == slides.c.project_id)
            .outerjoin(cases, cases.c.id == slides.c.case_id)
            .where(live_slides(project_id))
        )
    ).all()
    return [row.status for row in await describe(connection, list(rows), {})]


async def import_failure(
    connection: AsyncConnection, project_id: uuid.UUID
) -> ImportFailure | None:
    rows = await connection.execute(
        select(uploads.c.file_name, uploads.c.import_problems, slides.c.label)
        .outerjoin(slides, slides.c.id == uploads.c.slide_id)
        .where(
            uploads.c.project_id == project_id,
            uploads.c.kind == UploadKind.RESULT,
            uploads.c.import_problems.is_not(None),
            uploads.c.import_choices.is_(None),
        )
        .order_by(uploads.c.created_at.desc())
        .limit(20)
    )
    for row in rows:
        stored = cast("dict[str, Any]", row.import_problems or {})
        problems = cast("list[dict[str, Any]]", stored.get("problems") or [])
        count = sum(int(item.get("count", 0)) for item in problems)
        if count > 0:
            code = str(problems[0]["code"])
            return ImportFailure(
                file=row.file_name,
                slide_label=row.label or "",
                objects=count,
                reason=CHECK_PROBLEMS.get(code, code),
            )
    return None


@router.get(
    "/overview",
    operation_id="getProjectOverview",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_project_overview(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> ProjectOverview:
    project = await whole_project(connection, principal, project_id)
    case_count = await connection.scalar(
        select(func.count())
        .select_from(cases)
        .where(cases.c.project_id == project_id, cases.c.deleted_at.is_(None))
    )
    set_count = await connection.scalar(
        select(func.count()).select_from(result_sets).where(live_sets(project_id))
    )
    object_count = await connection.scalar(
        select(
            func.coalesce(func.sum(result_sets.c.region_count + result_sets.c.cell_count), 0)
        ).where(live_sets(project_id), result_sets.c.status == ResultStatus.READY)
    )
    used_bytes = await connection.scalar(
        select(func.coalesce(func.sum(slides.c.file_bytes), 0)).where(live_slides(project_id))
    )
    specimen_of = await first_specimens(connection, project_id)
    groups = await connection.execute(
        select(cases.c.id, cases.c.label, func.count(slides.c.id).label("slide_count"))
        .outerjoin(slides, and_(slides.c.case_id == cases.c.id, slides.c.deleted_at.is_(None)))
        .where(cases.c.project_id == project_id, cases.c.deleted_at.is_(None))
        .group_by(cases.c.id, cases.c.label)
        .order_by(cases.c.label_lower, cases.c.id)
    )
    files = await connection.execute(
        select(slides.c.id, slides.c.label, slides.c.stain, uploads.c.file_name)
        .outerjoin(uploads, uploads.c.id == slides.c.upload_id)
        .where(live_slides(project_id))
        .order_by(slides.c.created_at, slides.c.id)
    )
    states = await slide_states(connection, project_id)
    reviewed = sum(1 for state in states if state in REVIEWED)
    clinical = PrivacyMode(project.privacy_mode) is PrivacyMode.CLINICAL
    return ProjectOverview(
        project_id=project_id,
        cases=case_count or 0,
        slides=len(states),
        result_sets=set_count or 0,
        objects=int(object_count or 0),
        reviewed_percent=round(100 * reviewed / len(states), 1) if states else 0,
        needs_review=sum(1 for state in states if state in NEEDS_REVIEW),
        no_results=sum(1 for state in states if state is State.UPLOADED),
        case_groups=[
            CaseGroup(
                label=row.label, specimen=specimen_of.get(row.id, ""), slide_count=row.slide_count
            )
            for row in groups
        ],
        slide_files=[
            SlideFile(
                slide_id=row.id,
                file=(row.file_name if clinical else None) or row.label,
                stain=row.stain,
                remote=None,
            )
            for row in files
        ],
        study_template_id=project.study_template_id,
        storage=ProjectStorage(
            used_gb=round(int(used_bytes or 0) / BYTES_PER_GB, 2), allowance_gb=None
        ),
        import_failure=await import_failure(connection, project_id),
    )


@router.get(
    "/slides",
    operation_id="listProjectSlides",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_project_slides(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[ProjectSlide]:
    await visible(connection, principal, project_id)
    specimen_of = await first_specimens(connection, project_id)
    rows = (
        await connection.execute(
            select(
                slides.c.id,
                slides.c.label,
                slides.c.stain,
                slides.c.case_id,
                cases.c.label.label("case_label"),
                ai_hidden(principal, slides.c.project_id, slides.c.id).label("hidden"),
            )
            .outerjoin(cases, cases.c.id == slides.c.case_id)
            .where(
                live_slides(project_id),
                readable_slide(principal, slides.c.project_id, slides.c.id),
            )
            .order_by(slides.c.created_at, slides.c.id)
        )
    ).all()
    sets: dict[uuid.UUID, list[uuid.UUID]] = {}
    for item in await connection.execute(
        select(result_sets.c.id, result_sets.c.slide_id)
        .where(
            live_sets(project_id),
            result_sets.c.status == ResultStatus.READY,
            result_sets.c.slide_id.in_([row.id for row in rows]),
        )
        .order_by(result_sets.c.created_at, result_sets.c.id)
    ):
        sets.setdefault(item.slide_id, []).append(item.id)
    return [
        ProjectSlide(
            id=row.id,
            label=row.label,
            stain=row.stain,
            case=(
                None
                if row.case_id is None
                else SlideCase(
                    id=row.case_id, label=row.case_label, specimen=specimen_of.get(row.case_id, "")
                )
            ),
            result_set_ids=[] if row.hidden else sets.get(row.id, []),
        )
        for row in rows
    ]


@router.get(
    "/scope-options",
    operation_id="getProjectScopeOptions",
    **require(Permission.CREATE_CASES),
)
async def get_project_scope_options(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> ProjectScopeOptions:
    await whole_project(connection, principal, project_id)
    rois = await connection.execute(
        select(annotations.c.number, project_classes.c.name)
        .join(slides, slides.c.id == annotations.c.slide_id)
        .outerjoin(project_classes, project_classes.c.id == annotations.c.class_id)
        .where(
            live_slides(project_id),
            annotations.c.kind == AnnotationKind.ROI,
            annotations.c.deleted_at.is_(None),
        )
        .order_by(annotations.c.created_at, annotations.c.number, annotations.c.id)
    )
    named: list[str] = []
    for row in rois:
        name = row.name or f"ROI {row.number}"
        if name not in named:
            named.append(name)
    touching = (
        select(
            result_objects.c.number,
            result_objects.c.result_set_id,
            func.coalesce(func.sum(result_chunks.c.cell_count), 0).label("cells"),
        )
        .join(result_sets, result_sets.c.id == result_objects.c.result_set_id)
        .outerjoin(
            result_chunks,
            and_(
                result_chunks.c.result_set_id == result_objects.c.result_set_id,
                func.ST_Intersects(result_objects.c.geometry, tile()),
            ),
        )
        .where(
            live_sets(project_id),
            result_sets.c.status == ResultStatus.READY,
            result_objects.c.kind == ResultObjectKind.ZONE,
        )
        .group_by(result_objects.c.number, result_objects.c.result_set_id)
        .subquery()
    )
    zones = await connection.execute(
        select(
            touching.c.number,
            func.count().label("sets"),
            func.sum(touching.c.cells).label("cells"),
        )
        .group_by(touching.c.number)
        .order_by(touching.c.number)
    )
    return ProjectScopeOptions(
        rois=[ScopeRoi(key=f"R{index + 1}", name=name) for index, name in enumerate(named)],
        unsure_zones=[
            UnsureZone(key=f"Z{row.number}", cells_per_slide=int(row.cells) // row.sets)
            for row in zones
        ],
    )


@router.get(
    "/review-tasks/defaults",
    operation_id="getReviewTaskDefaults",
    **require(Permission.CREATE_CASES),
)
async def get_review_task_defaults(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> ReviewTaskDefaults:
    project = await whole_project(connection, principal, project_id)
    number = await connection.scalar(
        select(func.coalesce(func.max(review_tasks.c.number), 0) + 1).where(
            review_tasks.c.project_id == project_id
        )
    )
    ready = (
        await connection.execute(
            select(result_sets.c.id, result_sets.c.name, result_sets.c.slide_id)
            .join(slides, slides.c.id == result_sets.c.slide_id)
            .where(
                live_sets(project_id),
                live_slides(project_id),
                result_sets.c.status == ResultStatus.READY,
            )
            .order_by(result_sets.c.created_at, result_sets.c.id)
        )
    ).all()
    reviewers = await connection.scalars(
        select(project_members.c.user_id)
        .where(
            project_members.c.project_id == project_id,
            project_members.c.role == ProjectRole.REVIEWER,
        )
        .order_by(project_members.c.user_id)
    )
    today = datetime.now(UTC).date()
    slide_ids: list[uuid.UUID] = []
    for row in ready:
        if row.slide_id not in slide_ids:
            slide_ids.append(row.slide_id)
    return ReviewTaskDefaults(
        code=task_code(int(number or 1)),
        task_id=uuid.uuid4(),
        names=[SetName(result_set_id=row.id, name=row.name) for row in ready],
        slide_ids=slide_ids,
        result_set_id=str(ready[-1].id) if ready else "",
        reviewer_ids=list(reviewers.all()),
        due_on=today + timedelta(days=DEFAULT_DUE_DAYS),
        reminder_days=DEFAULT_REMINDER_DAYS,
        study_template_id=str(project.study_template_id or ""),
        today=today,
    )


async def first_owner(connection: AsyncConnection, project_id: uuid.UUID) -> uuid.UUID:
    owner = await connection.scalar(
        select(project_members.c.user_id)
        .where(
            project_members.c.project_id == project_id,
            project_members.c.role == ProjectRole.OWNER,
        )
        .order_by(project_members.c.user_id)
        .limit(1)
    )
    if owner is None:
        raise ProjectWithoutOwnerError
    return owner


def asked_events(tenant_id: uuid.UUID, project_id: uuid.UUID, actor_id: uuid.UUID) -> Any:
    return (
        select(audit_events.c.id, audit_events.c.occurred_at)
        .where(
            audit_events.c.tenant_id == tenant_id,
            audit_events.c.action == AuditAction.PROJECT_ACCESS_ASKED,
            audit_events.c.target_type == AuditTarget.PROJECT,
            audit_events.c.target_id == project_id,
            audit_events.c.actor_id == actor_id,
        )
        .order_by(audit_events.c.seq)
        .limit(1)
    )


@router.post(
    "/access-requests",
    operation_id="requestProjectAccess",
    **require(Permission.SEE_SLIDES),
)
async def request_project_access(
    project_id: uuid.UUID,
    request: Request,
    background: BackgroundTasks,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ProjectAccessRequest:
    member = member_of(principal)
    await row_of(connection, project_id)
    if await role_in(connection, principal, project_id) is not None:
        raise AlreadyInProjectError
    owner_id = await first_owner(connection, project_id)
    subject = actor_of(principal).subject
    assert subject is not None
    actor_id = await pseudonym_of(connection, subject)
    lookup = asked_events(member.tenant_id, project_id, actor_id)
    asked = (await connection.execute(lookup)).one_or_none()
    if asked is None:
        await audit(connection, principal, AuditAction.PROJECT_ACCESS_ASKED, project_id, {})
        asked = (await connection.execute(lookup)).one()
        await notify(
            connection,
            member.tenant_id,
            [owner_id],
            NotificationKind.PROJECT_ACCESS_ASKED,
            AuditTarget.PROJECT,
            project_id,
            {"user_id": str(member.user_id)},
        )
        background.add_task(deliver_after_commit, request.app, member.tenant_id)
    return ProjectAccessRequest(
        id=asked.id,
        project_id=project_id,
        user_id=member.user_id,
        owner_id=owner_id,
        asked_at=asked.occurred_at,
    )
