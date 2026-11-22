import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Response
from pydantic import BaseModel, StringConstraints, model_validator
from sqlalchemy import delete, exists, func, insert, select, text, tuple_, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import Geometry, InvalidShapeError, check_classes, checked
from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.decision_styles import answer_in_style, counted
from parfocal_api.drawn_sources import drawn_task_slides
from parfocal_api.outlines import outline_of
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import role_in
from parfocal_api.review_decisions import ai_class_of
from parfocal_api.review_order import Results
from parfocal_api.review_tasks import readable_task
from parfocal_api.reviewed_layer import KINDS, ai_object, outline
from parfocal_api.tables import (
    AnnotationKind,
    Decision,
    DecisionReason,
    DecisionStyle,
    DecisionValue,
    ProjectRole,
    adjudication_objects,
    adjudications,
    disagreement_decisions,
    evaluation_changes,
    evaluation_versions,
    review_assignments,
    review_decisions,
    review_edits,
    review_task_slides,
    review_tasks,
)
from parfocal_api.task_kinds import TaskSignedOffError, review_only
from parfocal_common.disagreements import Why, why_queued
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.result_store import ResultStore

type Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
type ChangeReason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
]
type Answer = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)]


class ReviewerAnswer(BaseModel):
    user_id: uuid.UUID
    answer: str
    value: DecisionValue
    reasons: list[DecisionReason]
    note: str | None = None
    reopened: bool


class QueueDecision(BaseModel):
    style: DecisionStyle | None
    answer: str | None
    answer_class_id: uuid.UUID | None
    kept_class_id: uuid.UUID | None = None
    value: DecisionValue
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


class ReviewerOutline(BaseModel):
    user_id: uuid.UUID
    outline: list[float]


class SettledOutline(BaseModel):
    outline: list[float]
    from_user_id: uuid.UUID | None
    by_user_id: uuid.UUID | None
    at: datetime


class OutlineDraft(BaseModel):
    from_user_id: uuid.UUID | None = None
    geometry: Geometry | None = None

    @model_validator(mode="after")
    def picks_or_draws(self) -> OutlineDraft:
        if (self.from_user_id is None) == (self.geometry is None):
            raise ValueError("Pick one reviewer's outline or draw a new one")
        if self.geometry is not None:
            checked(self.geometry)
        return self


class QueuedObject(BaseModel):
    slide_id: uuid.UUID
    object: str
    kind: AnnotationKind
    number: int
    why: Why
    decisions: list[ReviewerAnswer]
    outline_overlap: float | None = None
    outlines: list[ReviewerOutline] = []
    settled: SettledOutline | None = None
    decision: QueueDecision | None = None
    left_open: bool = False
    note: str | None = None
    edited_after_decisions: bool = False
    looking_again: bool = False
    adjudication: Adjudication | None = None
    drawn: bool = False

    def reviewers(self) -> list[ReviewerAnswer]:
        return self.decisions

    def with_adjudicator(self) -> bool:
        return self.adjudication is not None and self.adjudication.active


class DecisionDraft(BaseModel):
    answer: Answer
    answer_class_id: uuid.UUID | None = None
    note: Note | None = None
    reason: ChangeReason | None = None


class KeptTypeDraft(BaseModel):
    class_id: uuid.UUID
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


class NotReviewerOutlineError(BadRequestError):
    code = "not-a-reviewer-outline"
    title = "That person has no outline of this object to pick"


class NotRetypedError(BadRequestError):
    code = "not-retyped"
    title = "No reviewer gave this object that type"


class LookingAgainError(ConflictError):
    code = "looking-again"
    title = "The reviewers are looking at this object again"


router = APIRouter(prefix="/api/review-tasks/{task_id}/disagreements", tags=["review-tasks"])

type TaskKey = tuple[uuid.UUID, uuid.UUID, str, int]
type Complete = dict[tuple[uuid.UUID, uuid.UUID], tuple[set[uuid.UUID], datetime]]


async def complete_slides(connection: AsyncConnection, task_ids: list[uuid.UUID]) -> Complete:
    reviewers: dict[tuple[uuid.UUID, uuid.UUID], set[uuid.UUID]] = {}
    last: dict[tuple[uuid.UUID, uuid.UUID], datetime] = {}
    pending: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for task_id, slide_id, user_id, submitted_at in await connection.execute(
        select(
            review_assignments.c.task_id,
            review_assignments.c.slide_id,
            review_assignments.c.user_id,
            review_assignments.c.submitted_at,
        ).where(
            review_assignments.c.task_id.in_(task_ids), review_assignments.c.released_at.is_(None)
        )
    ):
        pair = (task_id, slide_id)
        reviewers.setdefault(pair, set()).add(user_id)
        if submitted_at is None:
            pending.add(pair)
        else:
            last[pair] = max(submitted_at, last.get(pair, submitted_at))
    return {pair: (people, last[pair]) for pair, people in reviewers.items() if pair not in pending}


async def last_redrawn(
    connection: AsyncConnection, task_ids: list[uuid.UUID]
) -> dict[TaskKey, datetime]:
    rows = await connection.execute(
        select(
            review_edits.c.task_id,
            review_edits.c.slide_id,
            review_edits.c.kind,
            review_edits.c.number,
            func.max(review_edits.c.updated_at),
        )
        .where(review_edits.c.task_id.in_(task_ids), review_edits.c.geometry.is_not(None))
        .group_by(
            review_edits.c.task_id,
            review_edits.c.slide_id,
            review_edits.c.kind,
            review_edits.c.number,
        )
    )
    return {(task_id, slide_id, kind, number): at for task_id, slide_id, kind, number, at in rows}


def decision_of(row: Any) -> QueueDecision | None:
    if row is None or row.value is None:
        return None
    return QueueDecision(
        style=DecisionStyle(row.style) if row.style else None,
        answer=row.answer,
        answer_class_id=row.answer_class_id,
        kept_class_id=row.kept_class_id,
        value=DecisionValue(row.value),
        choice=Decision(row.decision) if row.decision else None,
        decided_by_user_id=row.decided_by_user_id,
    )


def settled_of(row: Any) -> SettledOutline | None:
    if row is None:
        return None
    ring = outline_of(row.outline_shape)
    if ring is None:
        return None
    return SettledOutline(
        outline=ring,
        from_user_id=row.outline_from_user_id,
        by_user_id=row.outline_by_user_id,
        at=row.outline_at,
    )


def edited_after(redrawn: datetime | None, decided: datetime, settled: datetime | None) -> bool:
    if redrawn is None or redrawn <= decided:
        return False
    return settled is None or redrawn > settled


async def sent_objects(
    connection: AsyncConnection, task_ids: list[uuid.UUID]
) -> dict[TaskKey, Adjudication]:
    rows = await connection.execute(
        select(
            adjudication_objects.c.task_id.label("object_task_id"),
            adjudication_objects.c.slide_id,
            adjudication_objects.c.kind,
            adjudication_objects.c.number,
            adjudications,
        )
        .join(adjudications, adjudications.c.id == adjudication_objects.c.adjudication_id)
        .where(adjudication_objects.c.task_id.in_(task_ids))
        .order_by(adjudications.c.sent_at, adjudications.c.id)
    )
    return {
        (row.object_task_id, row.slide_id, row.kind, row.number): Adjudication(
            id=row.id,
            adjudicator_user_id=row.adjudicator_user_id,
            note=row.note,
            sent_at=row.sent_at,
            declined_at=row.declined_at,
            declined_note=row.declined_note,
        )
        for row in rows
    }


FINAL_OUTLINE = (
    "e.split = '' AND e.geometry IS NOT NULL AND ST_Dimension(e.geometry) = 2 "
    "AND NOT e.deleted AND e.retired IS NULL "
    "AND EXISTS (SELECT 1 FROM review_assignments r WHERE r.task_id = e.task_id "
    "AND r.slide_id = e.slide_id AND r.user_id = e.user_id AND r.released_at IS NULL) "
    "AND NOT EXISTS (SELECT 1 FROM review_assignments p WHERE p.task_id = e.task_id "
    "AND p.slide_id = e.slide_id AND p.released_at IS NULL AND p.submitted_at IS NULL)"
)


def overlap_of(first: str, second: str) -> str:
    return (
        f"CASE WHEN ST_Area(ST_Union({first}, {second})) > 0 "
        f"THEN ST_Area(ST_Intersection({first}, {second})) "
        f"/ ST_Area(ST_Union({first}, {second})) "
        f"WHEN ST_Equals({first}, {second}) THEN 1 ELSE 0 END"
    )


OPEN_TASKS_OF_PROJECTS = (
    "SELECT o.id FROM review_tasks o WHERE o.project_id = ANY(:project_ids) "
    "AND o.archived_at IS NULL AND o.signed_off_at IS NULL"
)


def outline_gaps_sql(tasks: str) -> str:
    return (
        "WITH final AS (SELECT e.task_id, e.slide_id, e.kind, e.number, e.user_id, e.geometry "
        f"FROM review_edits e WHERE {tasks} AND {FINAL_OUTLINE}), "
        "pairs AS (SELECT a.task_id, a.slide_id, a.kind, a.number, "
        f"{overlap_of('a.geometry', 'b.geometry')} AS overlap "
        "FROM final a JOIN final b ON a.task_id = b.task_id AND a.slide_id = b.slide_id "
        "AND a.kind = b.kind AND a.number = b.number AND a.user_id < b.user_id "
        "UNION ALL "
        f"SELECT f.task_id, f.slide_id, f.kind, f.number, {overlap_of('f.geometry', 'ai.outline')} "
        "FROM final f JOIN review_ai_outlines ai ON ai.task_id = f.task_id "
        "AND ai.slide_id = f.slide_id AND ai.kind = f.kind AND ai.number = f.number "
        "WHERE EXISTS (SELECT 1 FROM review_assignments r WHERE r.task_id = f.task_id "
        "AND r.slide_id = f.slide_id AND r.released_at IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM review_edits k WHERE k.task_id = r.task_id "
        "AND k.slide_id = r.slide_id AND k.user_id = r.user_id AND k.kind = f.kind "
        "AND k.number = f.number AND k.split = '' "
        "AND (k.deleted OR k.retired IS NOT NULL OR k.geometry IS NOT NULL)))) "
        "SELECT pairs.task_id, pairs.slide_id, pairs.kind, pairs.number, "
        "min(pairs.overlap) AS overlap, "
        "bool_or(d.value IS NOT NULL) IS TRUE AS decided, "
        "bool_or(d.left_open) IS TRUE AS left_open "
        "FROM pairs JOIN review_tasks t ON t.id = pairs.task_id "
        "LEFT JOIN disagreement_decisions d ON d.task_id = pairs.task_id "
        "AND d.slide_id = pairs.slide_id AND d.kind = pairs.kind AND d.number = pairs.number "
        "GROUP BY pairs.task_id, pairs.slide_id, pairs.kind, pairs.number, t.outline_overlap "
        "HAVING min(pairs.overlap) * 100 < t.outline_overlap"
    )


OUTLINE_GAPS = text(outline_gaps_sql("e.task_id = ANY(:task_ids)"))
OPEN_OUTLINE_GAPS = text(outline_gaps_sql(f"e.task_id IN ({OPEN_TASKS_OF_PROJECTS})"))

FINAL_OUTLINES = text(
    "SELECT e.task_id, e.slide_id, e.kind, e.number, e.user_id, "
    "ST_AsGeoJSON(e.geometry) AS shape FROM review_edits e "
    "WHERE e.task_id = ANY(:task_ids) AND e.slide_id = ANY(:slide_ids) "
    f"AND {FINAL_OUTLINE} "
    "ORDER BY e.task_id, e.slide_id, e.kind, e.number, e.user_id"
)


async def outline_gaps(
    connection: AsyncConnection, task_ids: list[uuid.UUID]
) -> dict[TaskKey, float]:
    rows = await connection.execute(OUTLINE_GAPS, {"task_ids": task_ids})
    return {(row.task_id, row.slide_id, row.kind, row.number): float(row.overlap) for row in rows}


async def outlines_of(
    connection: AsyncConnection, task_ids: list[uuid.UUID], keys: Collection[TaskKey]
) -> dict[TaskKey, list[ReviewerOutline]]:
    found: dict[TaskKey, list[ReviewerOutline]] = {}
    if not keys:
        return found
    wanted = {"task_ids": task_ids, "slide_ids": list({key[1] for key in keys})}
    for row in await connection.execute(FINAL_OUTLINES, wanted):
        key = (row.task_id, row.slide_id, row.kind, row.number)
        ring = outline_of(row.shape)
        if key in keys and ring is not None:
            found.setdefault(key, []).append(ReviewerOutline(user_id=row.user_id, outline=ring))
    return found


async def queue_of(connection: AsyncConnection, task_id: uuid.UUID) -> list[QueuedObject]:
    return (await queues_of(connection, [task_id]))[task_id]


def queued_why(rows: list[Any]) -> Why | None:
    second_look = {
        row.user_id
        for row in rows
        if row.value == DecisionValue.UNSURE and DecisionReason.NEED_SECOND_LOOK in row.reasons
    }
    return why_queued({row.user_id: row.value for row in rows}, second_look)


async def open_disagreements(
    connection: AsyncConnection, project_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    pending = review_assignments.alias("pending")
    reviewer = review_assignments.alias("reviewer")
    open_tasks = select(review_tasks.c.id).where(
        review_tasks.c.project_id.in_(project_ids),
        review_tasks.c.archived_at.is_(None),
        review_tasks.c.signed_off_at.is_(None),
    )
    rows = await connection.execute(
        select(
            review_decisions.c.task_id,
            review_decisions.c.slide_id,
            review_decisions.c.kind,
            review_decisions.c.number,
            review_decisions.c.user_id,
            review_decisions.c.value,
            review_decisions.c.reasons,
            review_decisions.c.reopened_at,
            disagreement_decisions.c.value.label("chosen_value"),
            disagreement_decisions.c.left_open,
        )
        .outerjoin(
            disagreement_decisions,
            (disagreement_decisions.c.task_id == review_decisions.c.task_id)
            & (disagreement_decisions.c.slide_id == review_decisions.c.slide_id)
            & (disagreement_decisions.c.kind == review_decisions.c.kind)
            & (disagreement_decisions.c.number == review_decisions.c.number),
        )
        .where(
            review_decisions.c.task_id.in_(open_tasks),
            exists().where(
                reviewer.c.task_id == review_decisions.c.task_id,
                reviewer.c.slide_id == review_decisions.c.slide_id,
                reviewer.c.user_id == review_decisions.c.user_id,
                reviewer.c.released_at.is_(None),
            ),
            ~exists().where(
                pending.c.task_id == review_decisions.c.task_id,
                pending.c.slide_id == review_decisions.c.slide_id,
                pending.c.released_at.is_(None),
                pending.c.submitted_at.is_(None),
            ),
        )
    )
    grouped: dict[TaskKey, list[Any]] = {}
    for row in rows:
        grouped.setdefault((row.task_id, row.slide_id, row.kind, row.number), []).append(row)
    gaps = {
        (row.task_id, row.slide_id, row.kind, row.number): (row.decided, row.left_open)
        for row in await connection.execute(OPEN_OUTLINE_GAPS, {"project_ids": project_ids})
    }
    by_task: dict[uuid.UUID, int] = {}
    for key, found in grouped.items():
        if (queued_why(found) is not None or key in gaps) and counts_as_open(
            looking_again=any(row.reopened_at is not None for row in found),
            decided=found[0].chosen_value is not None,
            left_open=bool(found[0].left_open),
        ):
            by_task[key[0]] = by_task.get(key[0], 0) + 1
    for key in gaps.keys() - grouped.keys():
        decided, left_open = gaps[key]
        if counts_as_open(looking_again=False, decided=decided, left_open=left_open):
            by_task[key[0]] = by_task.get(key[0], 0) + 1
    return by_task


async def queues_of(
    connection: AsyncConnection, task_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[QueuedObject]]:
    queues: dict[uuid.UUID, list[QueuedObject]] = {task_id: [] for task_id in task_ids}
    complete = await complete_slides(connection, task_ids)
    if not complete:
        return queues
    grouped: dict[TaskKey, list[Any]] = {}
    for row in await connection.execute(
        select(review_decisions)
        .where(tuple_(review_decisions.c.task_id, review_decisions.c.slide_id).in_(list(complete)))
        .order_by(
            review_decisions.c.task_id,
            review_decisions.c.slide_id,
            review_decisions.c.kind,
            review_decisions.c.number,
            review_decisions.c.user_id,
        )
    ):
        if row.user_id in complete[(row.task_id, row.slide_id)][0]:
            grouped.setdefault((row.task_id, row.slide_id, row.kind, row.number), []).append(row)
    decided = {
        (row.task_id, row.slide_id, row.kind, row.number): row
        for row in await connection.execute(
            select(
                disagreement_decisions,
                func.ST_AsGeoJSON(disagreement_decisions.c.outline).label("outline_shape"),
            ).where(disagreement_decisions.c.task_id.in_(task_ids))
        )
    }
    redrawn = await last_redrawn(connection, task_ids)
    sent = await sent_objects(connection, task_ids)
    gaps = await outline_gaps(connection, task_ids)
    drawn = await outlines_of(connection, task_ids, grouped.keys() | gaps.keys())
    by_hand = await drawn_task_slides(connection, task_ids)
    for key in sorted(grouped.keys() | gaps.keys()):
        task_id, slide_id, kind, number = key
        rows = grouped.get(key, [])
        why = queued_why(rows) or (Why.OUTLINES_DIFFER if key in gaps else None)
        if why is None:
            continue
        object_kind = AnnotationKind(kind)
        letter = Letter.REGION if object_kind is AnnotationKind.REGION else Letter.CELL
        choice = decided.get(key)
        looking_again = any(row.reopened_at is not None for row in rows)
        queues[task_id].append(
            QueuedObject(
                slide_id=slide_id,
                object=ObjectId(letter, number).text(ascii=True),
                kind=object_kind,
                number=number,
                drawn=letter is Letter.REGION and (task_id, slide_id) in by_hand,
                why=why,
                decisions=[
                    ReviewerAnswer(
                        user_id=row.user_id,
                        answer=row.answer,
                        value=DecisionValue(row.value),
                        reasons=[DecisionReason(code) for code in row.reasons],
                        note=row.note,
                        reopened=row.reopened_at is not None,
                    )
                    for row in rows
                ],
                outline_overlap=gaps.get(key),
                outlines=drawn.get(key, []),
                settled=settled_of(choice),
                decision=decision_of(choice),
                left_open=bool(choice and choice.left_open),
                note=choice.note if choice else None,
                edited_after_decisions=not looking_again
                and edited_after(
                    redrawn.get(key),
                    complete[(task_id, slide_id)][1],
                    choice.edits_settled_at if choice else None,
                ),
                looking_again=looking_again,
                adjudication=sent.get(key),
            )
        )
    return queues


def counts_as_open(*, looking_again: bool, decided: bool, left_open: bool) -> bool:
    return looking_again or (not decided and not left_open)


def is_open(item: QueuedObject) -> bool:
    return counts_as_open(
        looking_again=item.looking_again,
        decided=item.decision is not None,
        left_open=item.left_open,
    )


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
    "kept_class_id": None,
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
    touch: bool = True,
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
            set_={**changed, "updated_at": func.now()} if touch else changed,
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
    store: ResultStore,
    task: Any,
    slide_id: uuid.UUID,
    found: ObjectId,
    draft: DecisionDraft,
) -> DecisionValue:
    style = DecisionStyle(task.decision_style)
    answer_in_style(style, draft.answer, draft.answer_class_id)
    ai_class = None
    if draft.answer_class_id is not None:
        await check_classes(connection, task.project_id, {draft.answer_class_id})
        result_set_id = (
            await connection.execute(
                select(review_task_slides.c.result_set_id).where(
                    review_task_slides.c.task_id == task.id,
                    review_task_slides.c.slide_id == slide_id,
                )
            )
        ).scalar_one()
        ai_class = await ai_class_of(
            connection, store, result_set_id, KINDS[found.letter], found.number
        )
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
    results: Results,
) -> QueuedObject:
    task, found, item = await decidable(
        connection, principal, task_id, slide_id, object_id, Late(draft.reason)
    )
    if item.looking_again:
        raise LookingAgainError
    if item.with_adjudicator():
        raise WithAdjudicatorError
    value = await counted_value(connection, results, task, slide_id, found, draft)
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


async def reviewer_types(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, found: ObjectId
) -> set[uuid.UUID]:
    rows = await connection.scalars(
        select(review_edits.c.class_id).where(
            review_edits.c.task_id == task_id,
            review_edits.c.slide_id == slide_id,
            review_edits.c.kind == KINDS[found.letter],
            review_edits.c.number == found.number,
            review_edits.c.class_id.is_not(None),
            review_edits.c.split == "",
            review_edits.c.deleted.is_(False),
            review_edits.c.retired.is_(None),
        )
    )
    return set(rows)


@router.put(
    "/{slide_id}/{object_id}/kept-type",
    operation_id="keepReviewerType",
    **require(Permission.CREATE_CASES, write=True),
)
async def keep_reviewer_type(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: KeptTypeDraft,
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
    if draft.class_id not in await reviewer_types(connection, task_id, slide_id, found):
        raise NotRetypedError
    values = UNDECIDED | {
        "kept_class_id": draft.class_id,
        "value": DecisionValue.DISAGREE,
        "note": draft.note or None,
        "decided_by_user_id": decider(principal),
    }
    await store(connection, task, slide_id, found, values, values)
    late = await changed_after_sign_off(
        connection, principal, task, slide_id, found, "Kept the reviewer's type", draft.reason
    )
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_DECISION_SET,
        task,
        slide_id,
        found,
        {"kept_type": True, "value": DecisionValue.DISAGREE.value, **late},
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
                *where,
                disagreement_decisions.c.edits_settled_at.is_(None),
                disagreement_decisions.c.outline.is_(None),
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
        update(review_decisions)
        .where(
            review_decisions.c.task_id == task_id,
            review_decisions.c.slide_id == slide_id,
            review_decisions.c.kind == kind,
            review_decisions.c.number == found.number,
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


AREAS = frozenset({"Polygon", "MultiPolygon"})

UNSETTLED = {
    "outline": None,
    "outline_from_user_id": None,
    "outline_by_user_id": None,
    "outline_at": None,
}


async def picked_outline(
    connection: AsyncConnection,
    task_id: uuid.UUID,
    item: QueuedObject,
    found: ObjectId,
    draft: OutlineDraft,
) -> Any:
    if draft.geometry is not None:
        if draft.geometry.type not in AREAS:
            raise InvalidShapeError("A settled outline is an area")
        return await outline(connection, KINDS[found.letter], draft.geometry)
    if draft.from_user_id not in {drawn.user_id for drawn in item.outlines}:
        raise NotReviewerOutlineError
    return (
        select(review_edits.c.geometry)
        .where(
            review_edits.c.task_id == task_id,
            review_edits.c.slide_id == item.slide_id,
            review_edits.c.kind == item.kind,
            review_edits.c.number == item.number,
            review_edits.c.user_id == draft.from_user_id,
            review_edits.c.split == "",
        )
        .scalar_subquery()
    )


async def settle_outline(
    connection: AsyncConnection,
    principal: Principal,
    task: Any,
    item: QueuedObject,
    found: ObjectId,
    draft: OutlineDraft,
    details: dict[str, Any],
) -> None:
    if task.signed_off_at is not None:
        raise TaskSignedOffError
    values = {
        "outline": await picked_outline(connection, task.id, item, found, draft),
        "outline_from_user_id": draft.from_user_id,
        "outline_by_user_id": decider(principal),
        "outline_at": func.now(),
    }
    await store(connection, task, item.slide_id, found, UNDECIDED | values, values, touch=False)
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_OUTLINE_SETTLED,
        task,
        item.slide_id,
        found,
        {"picked": draft.from_user_id is not None, **details},
    )


async def clear_outline(
    connection: AsyncConnection,
    principal: Principal,
    task: Any,
    item: QueuedObject,
    found: ObjectId,
    details: dict[str, Any],
) -> None:
    if task.signed_off_at is not None:
        raise TaskSignedOffError
    if item.settled is None:
        return
    where = same_object(task.id, item.slide_id, item.kind, item.number)
    await connection.execute(
        delete(disagreement_decisions).where(
            *where,
            disagreement_decisions.c.value.is_(None),
            disagreement_decisions.c.left_open.is_(False),
            disagreement_decisions.c.edits_settled_at.is_(None),
        )
    )
    await connection.execute(update(disagreement_decisions).where(*where).values(**UNSETTLED))
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_OUTLINE_CLEARED,
        task,
        item.slide_id,
        found,
        details,
    )


async def owner_outline_object(
    connection: AsyncConnection,
    principal: Principal,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
) -> tuple[Any, ObjectId, QueuedObject]:
    task, found, item = await decidable(connection, principal, task_id, slide_id, object_id)
    if item.looking_again:
        raise LookingAgainError
    if item.with_adjudicator():
        raise WithAdjudicatorError
    return task, found, item
