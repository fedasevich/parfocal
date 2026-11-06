import uuid
from collections import Counter
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.disagreements import QueuedObject, is_open, queue_of
from parfocal_api.evaluation import (
    EvaluationHiddenError,
    added_objects,
    class_names,
    evaluate,
)
from parfocal_api.evaluation_exports import checksum_of, task_layout
from parfocal_api.notification_catalogue import TargetKind
from parfocal_api.notifications import deliver_after_commit, notify
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ConflictError
from parfocal_api.projects import ProjectArchivedError, owned
from parfocal_api.review_tasks import readable_task, task_row
from parfocal_api.tables import (
    NotificationKind,
    evaluation_changes,
    evaluation_versions,
    opinions,
    result_sets,
    review_assignments,
    review_task_slides,
    review_tasks,
    slides,
    threads,
)
from parfocal_api.task_kinds import review_only

type ConfirmedWith = Annotated[str, StringConstraints(pattern="^(sso|password)$")]
type VersionReason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=10, max_length=500)
]


class SignOffConfirmation(BaseModel):
    confirmed_with: ConfirmedWith = "sso"


class VersionDraft(BaseModel):
    reason: VersionReason


class EvaluationVersionStarted(BaseModel):
    version: int
    reason: str
    by_user_id: uuid.UUID | None
    started_at: datetime


class NotSignedOffError(ConflictError):
    code = "not-signed-off"
    title = "The task is not signed off"


class VersionOpenError(ConflictError):
    code = "evaluation-version-open"
    title = "A newer evaluation version is already open"


class ReviewerLeft(BaseModel):
    user_id: uuid.UUID
    slides_left: int


class Reviews(BaseModel):
    slides: int
    submitted: int
    total: int
    opinion_forms: int
    behind: list[ReviewerLeft]


class PersonCount(BaseModel):
    user_id: uuid.UUID
    count: int


class LeftOpenObject(BaseModel):
    object: str
    slide_label: str


class QueueSummary(BaseModel):
    total: int
    resolved: int
    by_researcher: int
    by_adjudicator: list[PersonCount]
    with_adjudicator: list[PersonCount]
    left_open: list[LeftOpenObject]


class SlideThreads(BaseModel):
    slide_label: str
    count: int


class OpenThreads(BaseModel):
    total: int
    slides: list[SlideThreads]


class ResultSetFacts(BaseModel):
    name: str
    objects: int
    added: int


class Signature(BaseModel):
    by_user_id: uuid.UUID | None
    at: datetime
    checksum: str


class EvaluationChange(BaseModel):
    version: int
    by_user_id: uuid.UUID | None
    at: datetime
    object: str
    slide_label: str
    text: str
    reason: str


class EvaluationChanges(BaseModel):
    task_id: uuid.UUID
    signed_version: int | None
    checksum: str | None
    changes: list[EvaluationChange]


class SignOffSummary(BaseModel):
    task_id: uuid.UUID
    version: int
    reviewer_ids: list[uuid.UUID]
    reviews: Reviews
    queue: QueueSummary
    open_threads: OpenThreads
    result_set: ResultSetFacts
    signature: Signature | None
    changes: list[EvaluationChange]
    next_version: EvaluationVersionStarted | None


router = APIRouter(prefix="/api/review-tasks/{task_id}", tags=["review-tasks"])


def user_of(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


async def versions_of(connection: AsyncConnection, task_id: uuid.UUID) -> list[Any]:
    return list(
        (
            await connection.execute(
                select(evaluation_versions)
                .where(evaluation_versions.c.task_id == task_id)
                .order_by(evaluation_versions.c.number)
            )
        ).all()
    )


def last_signed(versions: list[Any]) -> Any | None:
    signed = [row for row in versions if row.signed_at is not None]
    return signed[-1] if signed else None


def open_draft(versions: list[Any]) -> Any | None:
    return versions[-1] if versions and versions[-1].signed_at is None else None


async def reviewers_of(connection: AsyncConnection, task_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await connection.execute(
        select(review_assignments.c.user_id, func.min(review_assignments.c.assigned_at))
        .where(review_assignments.c.task_id == task_id)
        .group_by(review_assignments.c.user_id)
        .order_by(func.min(review_assignments.c.assigned_at), review_assignments.c.user_id)
    )
    return [row.user_id for row in rows]


async def record_signature(
    connection: AsyncConnection,
    principal: Principal,
    task: Any,
    confirmed_with: ConfirmedWith,
    http: Request,
    background: BackgroundTasks,
) -> int:
    evaluation = await evaluate(connection, task)
    blocks, report_format = await task_layout(connection, task)
    signed = {
        "signed_at": func.now(),
        "signed_by_user_id": user_of(principal),
        "confirmed_with": confirmed_with,
        "checksum": checksum_of(evaluation),
        "evaluation": evaluation.model_dump(mode="json"),
        "blocks": [block.model_dump(mode="json") for block in blocks],
        "format": report_format.model_dump(mode="json"),
    }
    versions = await versions_of(connection, task.id)
    draft = open_draft(versions)
    if draft is not None:
        number = draft.number
        await connection.execute(
            update(evaluation_versions).where(evaluation_versions.c.id == draft.id).values(**signed)
        )
    else:
        number = versions[-1].number + 1 if versions else 1
        await connection.execute(
            insert(evaluation_versions).values(
                tenant_id=task.tenant_id,
                task_id=task.id,
                number=number,
                started_by_user_id=user_of(principal),
                **signed,
            )
        )
    await notify(
        connection,
        task.tenant_id,
        [
            person
            for person in await reviewers_of(connection, task.id)
            if person != user_of(principal)
        ],
        NotificationKind.TASK_SIGNED_OFF,
        TargetKind.EVALUATION,
        task.id,
        {"version": number, "task_name": task.name},
    )
    background.add_task(deliver_after_commit, http.app, task.tenant_id)
    return number


async def start_next_version(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID, reason: str
) -> Any:
    task = await task_row(connection, task_id)
    review_only(task.kind)
    project = await owned(connection, principal, task.project_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    if task.signed_off_at is None:
        raise NotSignedOffError
    versions = await versions_of(connection, task_id)
    if open_draft(versions) is not None:
        raise VersionOpenError
    number = versions[-1].number + 1 if versions else 2
    started = (
        await connection.execute(
            insert(evaluation_versions)
            .values(
                tenant_id=task.tenant_id,
                task_id=task_id,
                number=number,
                reason=reason,
                started_by_user_id=user_of(principal),
            )
            .returning(evaluation_versions)
        )
    ).one()
    await connection.execute(
        update(review_tasks)
        .where(review_tasks.c.id == task_id)
        .values(signed_off_at=None, signed_off_by_user_id=None)
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.TASK_REOPENED,
        AuditTarget.REVIEW_TASK,
        task_id,
        tenant_id=task.tenant_id,
        details={"version": number, "reason_length": len(reason)},
    )
    return started


def as_started(row: Any) -> EvaluationVersionStarted:
    return EvaluationVersionStarted(
        version=row.number,
        reason=row.reason or "",
        by_user_id=row.started_by_user_id,
        started_at=row.started_at,
    )


@router.post(
    "/evaluation-versions",
    operation_id="startEvaluationVersion",
    status_code=201,
    **require(Permission.CREATE_CASES, write=True),
)
async def start_evaluation_version(
    task_id: uuid.UUID,
    draft: VersionDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> EvaluationVersionStarted:
    return as_started(await start_next_version(connection, principal, task_id, draft.reason))


async def labels_of(connection: AsyncConnection, slide_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not slide_ids:
        return {}
    rows = await connection.execute(
        select(slides.c.id, slides.c.label).where(slides.c.id.in_(slide_ids))
    )
    return {row.id: row.label or "" for row in rows}


async def reviews_of(connection: AsyncConnection, task_id: uuid.UUID) -> Reviews:
    live = (
        await connection.execute(
            select(review_assignments.c.user_id, review_assignments.c.submitted_at)
            .join(
                review_task_slides,
                (review_task_slides.c.task_id == review_assignments.c.task_id)
                & (review_task_slides.c.slide_id == review_assignments.c.slide_id),
            )
            .where(review_assignments.c.task_id == task_id)
        )
    ).all()
    left = Counter(row.user_id for row in live if row.submitted_at is None)
    task_slides = await connection.scalar(
        select(func.count()).where(review_task_slides.c.task_id == task_id)
    )
    forms = await connection.scalar(select(func.count()).where(opinions.c.task_id == task_id))
    return Reviews(
        slides=task_slides or 0,
        submitted=sum(row.submitted_at is not None for row in live),
        total=len(live),
        opinion_forms=forms or 0,
        behind=[ReviewerLeft(user_id=user, slides_left=count) for user, count in left.items()],
    )


def by_adjudicator(item: QueuedObject) -> bool:
    return (
        item.decision is not None
        and item.adjudication is not None
        and item.decision.decided_by_user_id == item.adjudication.adjudicator_user_id
    )


def counted(people: list[uuid.UUID]) -> list[PersonCount]:
    return [PersonCount(user_id=user, count=count) for user, count in Counter(people).items()]


def queue_summary(queue: list[QueuedObject], labels: dict[uuid.UUID, str]) -> QueueSummary:
    return QueueSummary(
        total=len(queue),
        resolved=sum(not is_open(item) for item in queue),
        by_researcher=sum(item.decision is not None and not by_adjudicator(item) for item in queue),
        by_adjudicator=counted(
            [
                item.adjudication.adjudicator_user_id
                for item in queue
                if by_adjudicator(item) and item.adjudication is not None
            ]
        ),
        with_adjudicator=counted(
            [
                item.adjudication.adjudicator_user_id
                for item in queue
                if item.with_adjudicator() and item.decision is None and item.adjudication
            ]
        ),
        left_open=[
            LeftOpenObject(object=item.object, slide_label=labels.get(item.slide_id, ""))
            for item in queue
            if item.left_open and not item.looking_again
        ],
    )


async def open_threads_of(
    connection: AsyncConnection, task_id: uuid.UUID
) -> list[tuple[uuid.UUID, int]]:
    rows = await connection.execute(
        select(threads.c.slide_id, func.count())
        .where(threads.c.task_id == task_id, threads.c.resolved_at.is_(None))
        .group_by(threads.c.slide_id)
    )
    return [(row[0], row[1]) for row in rows]


async def result_set_of(connection: AsyncConnection, task: Any) -> ResultSetFacts:
    rows = (
        await connection.execute(
            select(
                result_sets.c.name,
                result_sets.c.cell_count,
                result_sets.c.region_count,
            )
            .join(review_task_slides, review_task_slides.c.result_set_id == result_sets.c.id)
            .where(review_task_slides.c.task_id == task.id)
            .order_by(result_sets.c.name)
        )
    ).all()
    added, _ = await added_objects(
        connection, task.id, await class_names(connection, task.project_id)
    )
    return ResultSetFacts(
        name=", ".join(dict.fromkeys(row.name for row in rows)),
        objects=sum(row.cell_count + row.region_count for row in rows),
        added=len(added),
    )


async def changes_of(
    connection: AsyncConnection, task_id: uuid.UUID, version: int | None = None
) -> list[Any]:
    query = select(evaluation_changes).where(evaluation_changes.c.task_id == task_id)
    if version is not None:
        query = query.where(evaluation_changes.c.version == version)
    return list(
        (
            await connection.execute(
                query.order_by(evaluation_changes.c.changed_at, evaluation_changes.c.id)
            )
        ).all()
    )


def as_change(row: Any, labels: dict[uuid.UUID, str]) -> EvaluationChange:
    return EvaluationChange(
        version=row.version,
        by_user_id=row.changed_by_user_id,
        at=row.changed_at,
        object=row.object_id,
        slide_label=labels.get(row.slide_id, ""),
        text=CHANGE_TEXTS.get(row.change, row.change),
        reason=row.reason,
    )


CHANGE_TEXTS = {"added": "Added", "edited": "Edited", "deleted": "Deleted"}


@router.get(
    "/evaluation-changes",
    operation_id="listEvaluationChanges",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_evaluation_changes(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> EvaluationChanges:
    _, whole = await readable_task(connection, principal, task_id)
    if not whole:
        raise EvaluationHiddenError
    signed = last_signed(await versions_of(connection, task_id))
    changes = await changes_of(connection, task_id)
    labels = await labels_of(connection, {row.slide_id for row in changes})
    return EvaluationChanges(
        task_id=task_id,
        signed_version=signed.number if signed else None,
        checksum=signed.checksum if signed else None,
        changes=[as_change(row, labels) for row in changes],
    )


@router.get(
    "/sign-off-summary",
    operation_id="getSignOffSummary",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_sign_off_summary(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> SignOffSummary:
    task, whole = await readable_task(connection, principal, task_id)
    review_only(task.kind)
    if not whole:
        raise EvaluationHiddenError
    versions = await versions_of(connection, task_id)
    signed = last_signed(versions)
    draft = open_draft(versions)
    queue = await queue_of(connection, task_id)
    open_threads = await open_threads_of(connection, task_id)
    changes = await changes_of(connection, task_id, signed.number) if signed else []
    labels = await labels_of(
        connection,
        {item.slide_id for item in queue}
        | {slide_id for slide_id, _ in open_threads}
        | {row.slide_id for row in changes},
    )
    return SignOffSummary(
        task_id=task_id,
        version=signed.number if signed else draft.number if draft else 1,
        reviewer_ids=await reviewers_of(connection, task_id),
        reviews=await reviews_of(connection, task_id),
        queue=queue_summary(queue, labels),
        open_threads=OpenThreads(
            total=sum(count for _, count in open_threads),
            slides=[
                SlideThreads(slide_label=labels.get(slide_id, ""), count=count)
                for slide_id, count in sorted(
                    open_threads, key=lambda found: labels.get(found[0], "")
                )
            ],
        ),
        result_set=await result_set_of(connection, task),
        signature=Signature(
            by_user_id=signed.signed_by_user_id, at=signed.signed_at, checksum=signed.checksum
        )
        if signed
        else None,
        changes=[as_change(row, labels) for row in changes],
        next_version=as_started(draft) if draft is not None and signed is not None else None,
    )
