import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Response
from pydantic import BaseModel, StringConstraints
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import check_classes
from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.decision_styles import BlindCellsUnsupportedError, answer_in_style, counted
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import role_in
from parfocal_api.review_tasks import readable_task
from parfocal_api.reviewed_layer import KINDS, TaskSignedOffError, ai_object
from parfocal_api.tables import (
    AnnotationKind,
    Decision,
    DecisionStyle,
    ProjectRole,
    VerdictReason,
    VerdictValue,
    adjudication_objects,
    adjudications,
    disagreement_decisions,
    evaluation_changes,
    evaluation_versions,
    review_assignments,
    review_edits,
    review_task_slides,
    verdicts,
)
from parfocal_api.task_kinds import review_only
from parfocal_api.verdicts import ai_region_class
from parfocal_common.disagreements import Why, why_queued
from parfocal_common.object_ids import Letter, ObjectId

type Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
type ChangeReason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
]
type Answer = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)]


class ReviewerVerdict(BaseModel):
    user_id: uuid.UUID
    answer: str
    value: VerdictValue
    reasons: list[VerdictReason]
    note: str | None = None
    reopened: bool


class QueueDecision(BaseModel):
    style: DecisionStyle | None
    answer: str | None
    answer_class_id: uuid.UUID | None
    value: VerdictValue
    choice: Decision | None
    decided_by_user_id: uuid.UUID | None


class Adjudication(BaseModel):
    id: uuid.UUID
    adjudicator_user_id: uuid.UUID
    note: str | None
    sent_at: datetime
    declined_at: datetime | None
    declined_note: str | None

    @property
    def active(self) -> bool:
        return self.declined_at is None


class QueuedObject(BaseModel):
    slide_id: uuid.UUID
    object: str
    kind: AnnotationKind
    number: int
    why: Why
    verdicts: list[ReviewerVerdict]
    decision: QueueDecision | None = None
    left_open: bool = False
    note: str | None = None
    edited_after_decisions: bool = False
    looking_again: bool = False
    adjudication: Adjudication | None = None

    def reviewers(self) -> list[ReviewerVerdict]:
        return self.verdicts

    def with_adjudicator(self) -> bool:
        return self.adjudication is not None and self.adjudication.active


class DecisionDraft(BaseModel):
    answer: Answer
    answer_class_id: uuid.UUID | None = None
    note: Note | None = None
    reason: ChangeReason | None = None


class NoteDraft(BaseModel):
    note: Note | None = None
    reason: ChangeReason | None = None


@dataclass(frozen=True)
class Late:
    reason: str | None


class ChangeReasonNeededError(ConflictError):
    code = "change-reason-needed"
    title = "A change after sign-off needs a reason"


class NotQueuedError(NotFoundError):
    code = "not-queued"
    title = "This object is not in the disagreement queue"


class DecidersOnlyError(ForbiddenError):
    code = "project-owners-only"
    title = "Only an owner of this project decides disagreements"


class QueueHiddenError(ForbiddenError):
    code = "disagreements-hidden"
    title = "Reviewers do not see the disagreement queue"


class NotEditedError(ConflictError):
    code = "not-edited-after-decisions"
    title = "This object was not redrawn after its reviewers decided"


class WithAdjudicatorError(ConflictError):
    code = "with-adjudicator"
    title = "This object is with an adjudicator"


class LookingAgainError(ConflictError):
    code = "looking-again"
    title = "The reviewers are looking at this object again"


router = APIRouter(prefix="/api/review-tasks/{task_id}/disagreements", tags=["review-tasks"])

type Key = tuple[uuid.UUID, str, int]


async def complete_slides(
    connection: AsyncConnection, task_id: uuid.UUID
) -> dict[uuid.UUID, tuple[set[uuid.UUID], datetime]]:
    reviewers: dict[uuid.UUID, set[uuid.UUID]] = {}
    last: dict[uuid.UUID, datetime] = {}
    pending: set[uuid.UUID] = set()
    for slide_id, user_id, submitted_at in await connection.execute(
        select(
            review_assignments.c.slide_id,
            review_assignments.c.user_id,
            review_assignments.c.submitted_at,
        ).where(review_assignments.c.task_id == task_id, review_assignments.c.released_at.is_(None))
    ):
        reviewers.setdefault(slide_id, set()).add(user_id)
        if submitted_at is None:
            pending.add(slide_id)
        else:
            last[slide_id] = max(submitted_at, last.get(slide_id, submitted_at))
    return {
        slide: (people, last[slide]) for slide, people in reviewers.items() if slide not in pending
    }


async def last_redrawn(connection: AsyncConnection, task_id: uuid.UUID) -> dict[Key, datetime]:
    rows = await connection.execute(
        select(
            review_edits.c.slide_id,
            review_edits.c.kind,
            review_edits.c.number,
            func.max(review_edits.c.updated_at),
        )
        .where(review_edits.c.task_id == task_id, review_edits.c.geometry.is_not(None))
        .group_by(review_edits.c.slide_id, review_edits.c.kind, review_edits.c.number)
    )
    return {(slide_id, kind, number): at for slide_id, kind, number, at in rows}


def decision_of(row: Any) -> QueueDecision | None:
    if row is None or row.value is None:
        return None
    return QueueDecision(
        style=DecisionStyle(row.style) if row.style else None,
        answer=row.answer,
        answer_class_id=row.answer_class_id,
        value=VerdictValue(row.value),
        choice=Decision(row.decision) if row.decision else None,
        decided_by_user_id=row.decided_by_user_id,
    )


def edited_after(redrawn: datetime | None, decided: datetime, settled: datetime | None) -> bool:
    if redrawn is None or redrawn <= decided:
        return False
    return settled is None or redrawn > settled


async def sent_objects(connection: AsyncConnection, task_id: uuid.UUID) -> dict[Key, Adjudication]:
    rows = await connection.execute(
        select(
            adjudication_objects.c.slide_id,
            adjudication_objects.c.kind,
            adjudication_objects.c.number,
            adjudications,
        )
        .join(adjudications, adjudications.c.id == adjudication_objects.c.adjudication_id)
        .where(adjudication_objects.c.task_id == task_id)
        .order_by(adjudications.c.sent_at, adjudications.c.id)
    )
    return {
        (row.slide_id, row.kind, row.number): Adjudication(
            id=row.id,
            adjudicator_user_id=row.adjudicator_user_id,
            note=row.note,
            sent_at=row.sent_at,
            declined_at=row.declined_at,
            declined_note=row.declined_note,
        )
        for row in rows
    }


async def queue_of(connection: AsyncConnection, task_id: uuid.UUID) -> list[QueuedObject]:
    complete = await complete_slides(connection, task_id)
    if not complete:
        return []
    grouped: dict[Key, list[Any]] = {}
    for row in await connection.execute(
        select(verdicts)
        .where(verdicts.c.task_id == task_id, verdicts.c.slide_id.in_(list(complete)))
        .order_by(verdicts.c.slide_id, verdicts.c.kind, verdicts.c.number, verdicts.c.user_id)
    ):
        if row.user_id in complete[row.slide_id][0]:
            grouped.setdefault((row.slide_id, row.kind, row.number), []).append(row)
    decided = {
        (row.slide_id, row.kind, row.number): row
        for row in await connection.execute(
            select(disagreement_decisions).where(disagreement_decisions.c.task_id == task_id)
        )
    }
    redrawn = await last_redrawn(connection, task_id)
    sent = await sent_objects(connection, task_id)
    queued: list[QueuedObject] = []
    for key, rows in grouped.items():
        slide_id, kind, number = key
        second_look = {
            row.user_id
            for row in rows
            if row.value == VerdictValue.UNSURE and VerdictReason.NEED_SECOND_LOOK in row.reasons
        }
        why = why_queued({row.user_id: row.value for row in rows}, second_look)
        if why is None:
            continue
        object_kind = AnnotationKind(kind)
        letter = Letter.REGION if object_kind is AnnotationKind.REGION else Letter.CELL
        choice = decided.get(key)
        looking_again = any(row.reopened_at is not None for row in rows)
        queued.append(
            QueuedObject(
                slide_id=slide_id,
                object=ObjectId(letter, number).text(ascii=True),
                kind=object_kind,
                number=number,
                why=why,
                verdicts=[
                    ReviewerVerdict(
                        user_id=row.user_id,
                        answer=row.answer,
                        value=VerdictValue(row.value),
                        reasons=[VerdictReason(code) for code in row.reasons],
                        note=row.note,
                        reopened=row.reopened_at is not None,
                    )
                    for row in rows
                ],
                decision=decision_of(choice),
                left_open=bool(choice and choice.left_open),
                note=choice.note if choice else None,
                edited_after_decisions=not looking_again
                and edited_after(
                    redrawn.get(key),
                    complete[slide_id][1],
                    choice.edits_settled_at if choice else None,
                ),
                looking_again=looking_again,
                adjudication=sent.get(key),
            )
        )
    return queued


def is_open(item: QueuedObject) -> bool:
    return item.looking_again or (item.decision is None and not item.left_open)


def open_by_slide(queue: list[QueuedObject]) -> dict[uuid.UUID, int]:
    counts: dict[uuid.UUID, int] = {}
    for item in queue:
        if is_open(item):
            counts[item.slide_id] = counts.get(item.slide_id, 0) + 1
    return counts


def open_count(queue: list[QueuedObject]) -> int:
    return sum(is_open(item) for item in queue)


def left_open_count(queue: list[QueuedObject]) -> int:
    return sum(item.left_open and not item.looking_again for item in queue)


@router.get("", operation_id="listDisagreements", **require(Permission.SEE_SLIDES, emergency=True))
async def list_disagreements(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[QueuedObject]:
    task, whole = await readable_task(connection, principal, task_id)
    review_only(task.kind)
    if not whole:
        raise QueueHiddenError
    return await queue_of(connection, task_id)


async def decidable(
    connection: AsyncConnection,
    principal: Principal,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    late: Late | None = None,
) -> tuple[Any, ObjectId, QueuedObject]:
    task, _ = await readable_task(connection, principal, task_id)
    review_only(task.kind)
    if await role_in(connection, principal, task.project_id) is not ProjectRole.OWNER:
        raise DecidersOnlyError
    if task.signed_off_at is not None and late is None:
        raise TaskSignedOffError
    if task.signed_off_at is not None and late is not None and not late.reason:
        raise ChangeReasonNeededError
    found = ai_object(object_id)
    item = await queued_item(connection, task_id, slide_id, found)
    if item is None:
        raise NotQueuedError
    return task, found, item


async def queued_item(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, found: ObjectId
) -> QueuedObject | None:
    kind = KINDS[found.letter]
    return next(
        (
            item
            for item in await queue_of(connection, task_id)
            if item.slide_id == slide_id and item.kind is kind and item.number == found.number
        ),
        None,
    )


def same_object(
    task_id: uuid.UUID, slide_id: uuid.UUID, kind: AnnotationKind, number: int
) -> list[Any]:
    return [
        disagreement_decisions.c.task_id == task_id,
        disagreement_decisions.c.slide_id == slide_id,
        disagreement_decisions.c.kind == kind,
        disagreement_decisions.c.number == number,
    ]


UNDECIDED = {
    "decision": None,
    "style": None,
    "answer": None,
    "answer_class_id": None,
    "value": None,
    "left_open": False,
    "note": None,
}


async def store(
    connection: AsyncConnection,
    task: Any,
    slide_id: uuid.UUID,
    found: ObjectId,
    inserted: dict[str, Any],
    changed: dict[str, Any],
) -> None:
    await connection.execute(
        upsert(disagreement_decisions)
        .values(
            tenant_id=task.tenant_id,
            project_id=task.project_id,
            task_id=task.id,
            slide_id=slide_id,
            kind=KINDS[found.letter],
            number=found.number,
            **inserted,
        )
        .on_conflict_do_update(
            index_elements=[
                disagreement_decisions.c.task_id,
                disagreement_decisions.c.slide_id,
                disagreement_decisions.c.kind,
                disagreement_decisions.c.number,
            ],
            set_={**changed, "updated_at": func.now()},
        )
    )


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    task: Any,
    slide_id: uuid.UUID,
    found: ObjectId,
    details: dict[str, Any],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.REVIEW_TASK,
        task.id,
        tenant_id=task.tenant_id,
        details={"slide_id": str(slide_id), "object": found.text(ascii=True), **details},
    )


async def signed_version(connection: AsyncConnection, task_id: uuid.UUID) -> int:
    number = await connection.scalar(
        select(func.max(evaluation_versions.c.number)).where(
            evaluation_versions.c.task_id == task_id,
            evaluation_versions.c.signed_at.is_not(None),
        )
    )
    return number or 1


async def changed_after_sign_off(
    connection: AsyncConnection,
    principal: Principal,
    task: Any,
    slide_id: uuid.UUID,
    found: ObjectId,
    change: str,
    reason: str | None,
) -> dict[str, Any]:
    if task.signed_off_at is None or reason is None:
        return {}
    version = await signed_version(connection, task.id)
    await connection.execute(
        insert(evaluation_changes).values(
            tenant_id=task.tenant_id,
            task_id=task.id,
            version=version,
            slide_id=slide_id,
            object_id=found.text(ascii=True),
            change=change,
            reason=reason,
            changed_by_user_id=decider(principal),
        )
    )
    return {"after_sign_off": True, "evaluation_version": version}


async def refreshed(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, found: ObjectId
) -> QueuedObject:
    item = await queued_item(connection, task_id, slide_id, found)
    if item is None:
        raise NotQueuedError
    return item


def decider(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


async def counted_value(
    connection: AsyncConnection,
    task: Any,
    slide_id: uuid.UUID,
    found: ObjectId,
    draft: DecisionDraft,
) -> VerdictValue:
    style = DecisionStyle(task.decision_style)
    answer_in_style(style, draft.answer, draft.answer_class_id)
    ai_class = None
    if draft.answer_class_id is not None:
        if KINDS[found.letter] is not AnnotationKind.REGION:
            raise BlindCellsUnsupportedError
        await check_classes(connection, task.project_id, {draft.answer_class_id})
        result_set_id = (
            await connection.execute(
                select(review_task_slides.c.result_set_id).where(
                    review_task_slides.c.task_id == task.id,
                    review_task_slides.c.slide_id == slide_id,
                )
            )
        ).scalar_one()
        ai_class = await ai_region_class(connection, result_set_id, found.number)
    return counted(style, draft.answer, task.counts_as, draft.answer_class_id, ai_class)


@router.put(
    "/{slide_id}/{object_id}",
    operation_id="decideDisagreement",
    **require(Permission.CREATE_CASES, write=True),
)
async def decide_disagreement(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: DecisionDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> QueuedObject:
    task, found, item = await decidable(
        connection, principal, task_id, slide_id, object_id, Late(draft.reason)
    )
    if item.looking_again:
        raise LookingAgainError
    if item.with_adjudicator():
        raise WithAdjudicatorError
    value = await counted_value(connection, task, slide_id, found, draft)
    values = UNDECIDED | {
        "style": task.decision_style,
        "answer": draft.answer,
        "answer_class_id": draft.answer_class_id,
        "value": value,
        "note": draft.note or None,
        "decided_by_user_id": decider(principal),
    }
    await store(connection, task, slide_id, found, values, values)
    late = await changed_after_sign_off(
        connection, principal, task, slide_id, found, f"Decided {value.value}", draft.reason
    )
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_DECISION_SET,
        task,
        slide_id,
        found,
        {"style": task.decision_style, "answer": draft.answer, "value": value.value, **late},
    )
    return await refreshed(connection, task_id, slide_id, found)


@router.put(
    "/{slide_id}/{object_id}/left-open",
    operation_id="leaveDisagreementOpen",
    **require(Permission.CREATE_CASES, write=True),
)
async def leave_disagreement_open(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: NoteDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> QueuedObject:
    task, found, item = await decidable(
        connection, principal, task_id, slide_id, object_id, Late(draft.reason)
    )
    if item.looking_again:
        raise LookingAgainError
    if item.with_adjudicator():
        raise WithAdjudicatorError
    values = UNDECIDED | {
        "left_open": True,
        "note": draft.note or None,
        "decided_by_user_id": decider(principal),
    }
    await store(connection, task, slide_id, found, values, values)
    late = await changed_after_sign_off(
        connection, principal, task, slide_id, found, "Left open", draft.reason
    )
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_OBJECT_LEFT_OPEN,
        task,
        slide_id,
        found,
        {"noted": bool(draft.note), **late},
    )
    return await refreshed(connection, task_id, slide_id, found)


@router.delete(
    "/{slide_id}/{object_id}",
    operation_id="clearDisagreementDecision",
    status_code=204,
    **require(Permission.CREATE_CASES, write=True),
)
async def clear_disagreement_decision(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Response:
    task, found, item = await decidable(connection, principal, task_id, slide_id, object_id)
    where = same_object(task_id, slide_id, KINDS[found.letter], found.number)
    if item.decision is not None or item.left_open:
        await connection.execute(
            delete(disagreement_decisions).where(
                *where, disagreement_decisions.c.edits_settled_at.is_(None)
            )
        )
        await connection.execute(
            update(disagreement_decisions).where(*where).values(**UNDECIDED, updated_at=func.now())
        )
        await audit(
            connection,
            principal,
            AuditAction.REVIEW_DECISION_CLEARED,
            task,
            slide_id,
            found,
            {"left_open": item.left_open},
        )
    return Response(status_code=204)


async def edited_object(
    connection: AsyncConnection,
    principal: Principal,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    again: bool = False,
) -> tuple[Any, ObjectId]:
    task, found, item = await decidable(connection, principal, task_id, slide_id, object_id)
    if not (item.edited_after_decisions or (again and item.looking_again)):
        raise NotEditedError
    return task, found


@router.post(
    "/{slide_id}/{object_id}/look-again",
    operation_id="askReviewersToLookAgain",
    **require(Permission.CREATE_CASES, write=True),
)
async def ask_reviewers_to_look_again(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: NoteDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> QueuedObject:
    task, found = await edited_object(
        connection, principal, task_id, slide_id, object_id, again=True
    )
    kind = KINDS[found.letter]
    reopened = await connection.execute(
        update(verdicts)
        .where(
            verdicts.c.task_id == task_id,
            verdicts.c.slide_id == slide_id,
            verdicts.c.kind == kind,
            verdicts.c.number == found.number,
        )
        .values(reopened_at=func.now(), reopened_note=draft.note or None, updated_at=func.now())
    )
    settled = UNDECIDED | {"edits_settled_at": func.now()}
    await store(connection, task, slide_id, found, settled, settled)
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_LOOK_AGAIN_ASKED,
        task,
        slide_id,
        found,
        {"reopened": reopened.rowcount, "noted": bool(draft.note)},
    )
    return await refreshed(connection, task_id, slide_id, found)


@router.post(
    "/{slide_id}/{object_id}/keep-decisions",
    operation_id="keepReviewerDecisions",
    **require(Permission.CREATE_CASES, write=True),
)
async def keep_reviewer_decisions(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> QueuedObject:
    task, found = await edited_object(connection, principal, task_id, slide_id, object_id)
    settled = {"edits_settled_at": func.now()}
    await store(connection, task, slide_id, found, UNDECIDED | settled, settled)
    await audit(connection, principal, AuditAction.REVIEW_DECISIONS_KEPT, task, slide_id, found, {})
    return await refreshed(connection, task_id, slide_id, found)


def choice_value(row: Any) -> str | None:
    if row.left_open:
        return "left-open"
    if row.value is not None:
        return str(row.value)
    return None
