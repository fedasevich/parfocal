import uuid
from collections.abc import Iterable, Mapping
from datetime import date, datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.adjudications import decide_as_adjudicator, me, reviewers_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.decision_styles import ANSWERS
from parfocal_api.disagreements import (
    DecisionDraft,
    NoteDraft,
    QueuedObject,
    QueueHiddenError,
    ask_reviewers_to_look_again,
    decide_disagreement,
    keep_reviewer_decisions,
    leave_disagreement_open,
    queue_of,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import BadRequestError, NotFoundError
from parfocal_api.review_objects import UNKNOWN, AiClaim, ai_claims, kind_of
from parfocal_api.review_order import Results
from parfocal_api.review_tasks import readable_task, task_row
from parfocal_api.reviewed_layer import ai_object
from parfocal_api.tables import (
    REASON_TEXT,
    DecisionStyle,
    adjudications,
    disagreement_decisions,
    project_classes,
    review_assignments,
    review_decisions,
    review_edits,
    review_order,
    review_task_slides,
    slides,
)
from parfocal_api.task_kinds import review_only
from parfocal_common.disagreements import Why
from parfocal_common.object_ids import Letter
from parfocal_common.result_store import ResultStore

type Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
type Raw = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
type Key = tuple[uuid.UUID, str, int]

type ObjectKind = Literal["region", "cell"]

CLASS_ANSWER = "class"


class QueueTag(StrEnum):
    DIFFER = "differ"
    BOTH_AI = "bothai"
    SECOND = "second"


class QueueRowState(StrEnum):
    OPEN = "open"
    DECIDED = "decided"
    LEFT_OPEN = "left-open"
    WITH_ADJUDICATOR = "with-adjudicator"
    DECLINED = "declined"
    ADJUDICATED = "adjudicated"
    LOOK_AGAIN = "look-again"


class QueueAction(StrEnum):
    DECIDE = "decide"
    LEAVE_OPEN = "leave-open"
    LOOK_AGAIN = "look-again"
    KEEP_DECISIONS = "keep-decisions"


class QueueAnswer(StrEnum):
    AGREE = "agree"
    DISAGREE = "disagree"
    UNSURE = "unsure"


TAGS = {Why.REVIEWERS_DIFFER: QueueTag.DIFFER, Why.AGAINST_THE_AI: QueueTag.BOTH_AI}


class AiCall(BaseModel):
    class_name: str
    score: float


class QueueAnswerRecord(BaseModel):
    user_id: uuid.UUID
    raw: str
    reason: str | None
    note: str | None


class QueueRowDecision(BaseModel):
    raw: str
    note: str | None
    by_user_id: uuid.UUID
    at: datetime


class QueueAdjudicator(BaseModel):
    user_id: uuid.UUID
    note: str | None


class QueueEdit(BaseModel):
    by_user_id: uuid.UUID
    on: date


class QueueRow(BaseModel):
    key: str
    slide_id: uuid.UUID
    slide_label: str
    object: str
    kind: ObjectKind
    ai: AiCall
    size_mm: float | None
    tag: QueueTag
    answers: list[QueueAnswerRecord]
    state: QueueRowState
    decision: QueueRowDecision | None
    adjudicator: QueueAdjudicator | None
    edited: QueueEdit | None


class QueueLock(BaseModel):
    user_id: uuid.UUID
    slides_left: int


class DisagreementQueue(BaseModel):
    task_id: uuid.UUID
    total_objects: int
    locked: QueueLock | None
    rows: list[QueueRow]


class QueuedObjectUpdate(BaseModel):
    action: QueueAction
    raw: Raw | None = None
    counts_as: QueueAnswer | None = None
    note: Note | None = None


class AnonymousAnswer(BaseModel):
    raw: str
    reason: str | None
    note: str | None


class AdjudicationObject(BaseModel):
    key: str
    slide_id: uuid.UUID
    slide_label: str
    object: str
    kind: ObjectKind
    ai: AiCall
    size_mm: float | None
    reviewer_a: AnonymousAnswer
    reviewer_b: AnonymousAnswer
    decision: str | None
    decision_note: str | None


class MyAdjudicationTask(BaseModel):
    task_id: uuid.UUID
    asked_by_user_id: uuid.UUID
    note: str | None
    objects: list[AdjudicationObject]


class AdjudicationAnswer(BaseModel):
    raw: Raw
    note: Note | None = None


class RawNeededError(BadRequestError):
    code = "answer-needed"
    title = "Deciding needs an answer"


class UnknownClassAnswerError(BadRequestError):
    code = "unknown-class-answer"
    title = "No class of this project has that name"


router = APIRouter(prefix="/api/review-tasks/{task_id}", tags=["review-tasks"])
adjudication_router = APIRouter(prefix="/api/review-tasks/{task_id}", tags=["adjudications"])


def key_of(item: QueuedObject) -> Key:
    return item.slide_id, item.kind.value, item.number


def letter_of(item: QueuedObject) -> Letter:
    return Letter.REGION if item.kind.value == "region" else Letter.CELL


async def labels_of(connection: AsyncConnection, slide_ids: Iterable[uuid.UUID]) -> dict[Any, str]:
    wanted = list(set(slide_ids))
    if not wanted:
        return {}
    rows = await connection.execute(
        select(slides.c.id, slides.c.label).where(slides.c.id.in_(wanted))
    )
    return {row.id: row.label for row in rows}


async def class_names(connection: AsyncConnection, project_id: uuid.UUID) -> dict[Any, str]:
    rows = await connection.execute(
        select(project_classes.c.id, project_classes.c.name).where(
            project_classes.c.project_id == project_id
        )
    )
    return {row.id: row.name for row in rows}


async def answer_classes(connection: AsyncConnection, task_id: uuid.UUID) -> dict[Any, uuid.UUID]:
    rows = await connection.execute(
        select(
            review_decisions.c.slide_id,
            review_decisions.c.kind,
            review_decisions.c.number,
            review_decisions.c.user_id,
            review_decisions.c.answer_class_id,
        ).where(
            review_decisions.c.task_id == task_id, review_decisions.c.answer_class_id.is_not(None)
        )
    )
    return {(row.slide_id, row.kind, row.number, row.user_id): row.answer_class_id for row in rows}


def raw_of(answer: str | None, class_id: uuid.UUID | None, names: Mapping[Any, str]) -> str:
    if answer == CLASS_ANSWER and class_id is not None:
        return names.get(class_id, CLASS_ANSWER)
    return answer or ""


def reason_of(reasons: Iterable[str]) -> str | None:
    first = next(iter(reasons), None)
    return None if first is None else REASON_TEXT.get(first, first)


async def claims_of(
    connection: AsyncConnection, store: ResultStore, task_id: uuid.UUID, queue: list[QueuedObject]
) -> dict[Key, AiClaim]:
    sets = {
        row.slide_id: row.result_set_id
        for row in await connection.execute(
            select(review_task_slides.c.slide_id, review_task_slides.c.result_set_id).where(
                review_task_slides.c.task_id == task_id
            )
        )
    }
    claims: dict[Key, AiClaim] = {}
    for slide_id in {item.slide_id for item in queue}:
        on_slide = [item for item in queue if item.slide_id == slide_id]
        found = await ai_claims(
            connection,
            store,
            sets.get(slide_id),
            slide_id,
            [(letter_of(item), item.number) for item in on_slide],
        )
        for item in on_slide:
            claims[key_of(item)] = found.get((letter_of(item), item.number), UNKNOWN)
    return claims


async def decided_at(connection: AsyncConnection, task_id: uuid.UUID) -> dict[Key, datetime]:
    rows = await connection.execute(
        select(
            disagreement_decisions.c.slide_id,
            disagreement_decisions.c.kind,
            disagreement_decisions.c.number,
            disagreement_decisions.c.updated_at,
        ).where(disagreement_decisions.c.task_id == task_id)
    )
    return {(row.slide_id, row.kind, row.number): row.updated_at for row in rows}


async def last_editors(connection: AsyncConnection, task_id: uuid.UUID) -> dict[Key, Any]:
    rows = await connection.execute(
        select(
            review_edits.c.slide_id,
            review_edits.c.kind,
            review_edits.c.number,
            review_edits.c.user_id,
            review_edits.c.updated_at,
        )
        .where(review_edits.c.task_id == task_id, review_edits.c.geometry.is_not(None))
        .order_by(review_edits.c.updated_at)
    )
    return {(row.slide_id, row.kind, row.number): row for row in rows}


def state_of(item: QueuedObject) -> QueueRowState:
    sent = item.adjudication
    decision = item.decision
    if item.looking_again:
        return QueueRowState.LOOK_AGAIN
    if sent is not None and sent.active:
        if decision is not None and decision.decided_by_user_id == sent.adjudicator_user_id:
            return QueueRowState.ADJUDICATED
        return QueueRowState.WITH_ADJUDICATOR
    if item.left_open:
        return QueueRowState.LEFT_OPEN
    if decision is not None:
        return QueueRowState.DECIDED
    if sent is not None:
        return QueueRowState.DECLINED
    return QueueRowState.OPEN


class QueueFacts:
    def __init__(
        self,
        labels: dict[Any, str],
        names: dict[Any, str],
        picked: dict[Any, uuid.UUID],
        claims: dict[Key, AiClaim],
        decided: dict[Key, datetime],
        editors: dict[Key, Any],
    ) -> None:
        self.labels = labels
        self.names = names
        self.picked = picked
        self.claims = claims
        self.decided = decided
        self.editors = editors

    def label(self, item: QueuedObject) -> str:
        return self.labels.get(item.slide_id, "")

    def claim(self, item: QueuedObject) -> AiClaim:
        return self.claims.get(key_of(item), UNKNOWN)

    def raw(self, item: QueuedObject, user_id: uuid.UUID, answer: str) -> str:
        return raw_of(answer, self.picked.get((*key_of(item), user_id)), self.names)


async def facts_of(
    connection: AsyncConnection,
    store: ResultStore,
    task: Any,
    queue: list[QueuedObject],
) -> QueueFacts:
    return QueueFacts(
        labels=await labels_of(connection, (item.slide_id for item in queue)),
        names=await class_names(connection, task.project_id),
        picked=await answer_classes(connection, task.id),
        claims=await claims_of(connection, store, task.id, queue),
        decided=await decided_at(connection, task.id),
        editors=await last_editors(connection, task.id),
    )


def row_of(item: QueuedObject, facts: QueueFacts) -> QueueRow:
    claim = facts.claim(item)
    label = facts.label(item)
    decision = item.decision
    sent = item.adjudication
    editor = facts.editors.get(key_of(item)) if item.edited_after_decisions else None
    return QueueRow(
        key=f"{label}:{item.object}",
        slide_id=item.slide_id,
        slide_label=label,
        object=item.object,
        kind=kind_of(letter_of(item)),
        ai=AiCall(class_name=claim.class_name, score=claim.score),
        size_mm=claim.size_mm,
        tag=TAGS.get(item.why, QueueTag.SECOND),
        answers=[
            QueueAnswerRecord(
                user_id=given.user_id,
                raw=facts.raw(item, given.user_id, given.answer),
                reason=reason_of(given.reasons),
                note=given.note,
            )
            for given in item.reviewers()
        ],
        state=state_of(item),
        decision=None
        if decision is None or decision.decided_by_user_id is None
        else QueueRowDecision(
            raw=raw_of(decision.answer, decision.answer_class_id, facts.names),
            note=item.note,
            by_user_id=decision.decided_by_user_id,
            at=facts.decided.get(key_of(item), datetime.now().astimezone()),
        ),
        adjudicator=None
        if sent is None
        else QueueAdjudicator(
            user_id=sent.adjudicator_user_id,
            note=sent.note if sent.active else sent.declined_note,
        ),
        edited=None
        if editor is None
        else QueueEdit(by_user_id=editor.user_id, on=editor.updated_at.date()),
    )


async def total_objects(connection: AsyncConnection, task_id: uuid.UUID) -> int:
    total = await connection.scalar(
        select(func.coalesce(func.sum(review_order.c.count), 0)).where(
            review_order.c.task_id == task_id
        )
    )
    return int(total or 0)


async def lock_of(connection: AsyncConnection, task_id: uuid.UUID) -> QueueLock | None:
    behind = (
        await connection.execute(
            select(review_assignments.c.user_id, func.count().label("left"))
            .where(
                review_assignments.c.task_id == task_id,
                review_assignments.c.released_at.is_(None),
                review_assignments.c.submitted_at.is_(None),
            )
            .group_by(review_assignments.c.user_id)
            .order_by(func.count().desc(), review_assignments.c.user_id)
            .limit(1)
        )
    ).one_or_none()
    return None if behind is None else QueueLock(user_id=behind.user_id, slides_left=behind.left)


async def queue_task(connection: AsyncConnection, principal: Any, task_id: uuid.UUID) -> Any:
    task, whole = await readable_task(connection, principal, task_id)
    review_only(task.kind)
    if not whole:
        raise QueueHiddenError
    return task


@router.get(
    "/disagreement-queue",
    operation_id="getDisagreementQueue",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_disagreement_queue(
    task_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> DisagreementQueue:
    task = await queue_task(connection, principal, task_id)
    queue = await queue_of(connection, task_id)
    facts = await facts_of(connection, results, task, queue)
    return DisagreementQueue(
        task_id=task_id,
        total_objects=await total_objects(connection, task_id),
        locked=await lock_of(connection, task_id),
        rows=[row_of(item, facts) for item in queue],
    )


async def answer_for(
    connection: AsyncConnection, task: Any, raw: str | None
) -> tuple[str, uuid.UUID | None]:
    if raw is None:
        raise RawNeededError
    allowed = ANSWERS[DecisionStyle(task.decision_style)]
    if raw in allowed:
        return raw, None
    if CLASS_ANSWER not in allowed:
        return raw, None
    class_id = await connection.scalar(
        select(project_classes.c.id).where(
            project_classes.c.project_id == task.project_id,
            func.lower(project_classes.c.name) == raw.lower(),
        )
    )
    if class_id is None:
        raise UnknownClassAnswerError
    return CLASS_ANSWER, class_id


async def queued_row(
    connection: AsyncConnection,
    store: ResultStore,
    task: Any,
    slide_id: uuid.UUID,
    object_id: str,
) -> QueueRow:
    found = ai_object(object_id)
    kind = "region" if found.letter is Letter.REGION else "cell"
    queue = [
        item
        for item in await queue_of(connection, task.id)
        if item.slide_id == slide_id and item.kind.value == kind and item.number == found.number
    ]
    if not queue:
        raise NotFoundError("This object is not in the disagreement queue")
    return row_of(queue[0], await facts_of(connection, store, task, queue))


@router.post(
    "/disagreement-queue/{slide_id}/{object_id}",
    operation_id="updateQueuedObject",
    **require(Permission.CREATE_CASES, write=True),
)
async def update_queued_object(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    update: QueuedObjectUpdate,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> QueueRow:
    task, _ = await readable_task(connection, principal, task_id)
    match update.action:
        case QueueAction.DECIDE:
            answer, class_id = await answer_for(connection, task, update.raw)
            await decide_disagreement(
                task_id,
                slide_id,
                object_id,
                DecisionDraft(answer=answer, answer_class_id=class_id, note=update.note),
                principal,
                connection,
                results,
            )
        case QueueAction.LEAVE_OPEN:
            await leave_disagreement_open(
                task_id, slide_id, object_id, NoteDraft(note=update.note), principal, connection
            )
        case QueueAction.LOOK_AGAIN:
            await ask_reviewers_to_look_again(
                task_id, slide_id, object_id, NoteDraft(note=update.note), principal, connection
            )
        case QueueAction.KEEP_DECISIONS:
            await keep_reviewer_decisions(task_id, slide_id, object_id, principal, connection)
    return await queued_row(connection, results, task, slide_id, object_id)


def anonymous(item: QueuedObject, facts: QueueFacts, letters: dict[uuid.UUID, str]) -> list[Any]:
    given = sorted(item.reviewers(), key=lambda answer: letters.get(answer.user_id, "~"))
    shown = [
        AnonymousAnswer(
            raw=facts.raw(item, answer.user_id, answer.answer),
            reason=reason_of(answer.reasons),
            note=answer.note,
        )
        for answer in given
    ]
    empty = AnonymousAnswer(raw="", reason=None, note=None)
    return [*shown, empty, empty][:2]


def adjudication_object(
    item: QueuedObject, facts: QueueFacts, letters: dict[uuid.UUID, str], user_id: uuid.UUID
) -> AdjudicationObject:
    claim = facts.claim(item)
    label = facts.label(item)
    first, second = anonymous(item, facts, letters)
    decision = item.decision
    mine = decision is not None and decision.decided_by_user_id == user_id
    return AdjudicationObject(
        key=f"{label}:{item.object}",
        slide_id=item.slide_id,
        slide_label=label,
        object=item.object,
        kind=kind_of(letter_of(item)),
        ai=AiCall(class_name=claim.class_name, score=claim.score),
        size_mm=claim.size_mm,
        reviewer_a=first,
        reviewer_b=second,
        decision=raw_of(decision.answer, decision.answer_class_id, facts.names)
        if mine and decision is not None
        else None,
        decision_note=item.note if mine else None,
    )


def for_me(item: QueuedObject, user_id: uuid.UUID) -> bool:
    sent = item.adjudication
    return sent is not None and sent.active and sent.adjudicator_user_id == user_id


async def adjudication_task(
    connection: AsyncConnection, store: ResultStore, task: Any, user_id: uuid.UUID
) -> MyAdjudicationTask:
    queue = [item for item in await queue_of(connection, task.id) if for_me(item, user_id)]
    if not queue:
        raise NotFoundError("Adjudication not found")
    facts = await facts_of(connection, store, task, queue)
    letters = {
        person: chr(ord("A") + index % 26)
        for index, person in enumerate(await reviewers_of(connection, task.id))
    }
    latest = max(
        (item.adjudication for item in queue if item.adjudication is not None),
        key=lambda sent: sent.sent_at,
    )
    asked_by = await connection.scalar(
        select(adjudications.c.sent_by_user_id).where(adjudications.c.id == latest.id)
    )
    return MyAdjudicationTask(
        task_id=task.id,
        asked_by_user_id=asked_by or user_id,
        note=latest.note,
        objects=[adjudication_object(item, facts, letters, user_id) for item in queue],
    )


@adjudication_router.get(
    "/adjudication", operation_id="getMyAdjudication", **require(Permission.REVIEW)
)
async def get_my_adjudication(
    task_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> MyAdjudicationTask:
    user_id = me(principal)
    return await adjudication_task(
        connection, results, await task_row(connection, task_id), user_id
    )


@adjudication_router.post(
    "/adjudication/{slide_id}/{object_id}",
    operation_id="decideAdjudication",
    **require(Permission.REVIEW, write=True),
)
async def decide_adjudication(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    answer: AdjudicationAnswer,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> AdjudicationObject:
    user_id = me(principal)
    task = await task_row(connection, task_id)
    raw, class_id = await answer_for(connection, task, answer.raw)
    await decide_as_adjudicator(
        task_id,
        slide_id,
        object_id,
        DecisionDraft(answer=raw, answer_class_id=class_id, note=answer.note),
        principal,
        connection,
        results,
    )
    shown = await adjudication_task(connection, results, task, user_id)
    found = ai_object(object_id).text(ascii=True)
    return next(
        item for item in shown.objects if item.slide_id == slide_id and item.object == found
    )
