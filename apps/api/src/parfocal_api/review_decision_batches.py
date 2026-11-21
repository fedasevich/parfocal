import uuid
from collections.abc import Iterable, Sequence
from typing import Any

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import ARRAY, Text, bindparam, delete, func, select, tuple_
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import check_classes
from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record_each
from parfocal_api.blinding import require_judging_allowed, user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.decision_styles import answer_in_style, counted
from parfocal_api.permissions import Permission, require
from parfocal_api.result_membership import require_ai_object
from parfocal_api.review_decisions import (
    Answer,
    NotASetClassError,
    ReviewDecision,
    Score,
    ai_details,
    preset_in_force,
    review_decision_of,
    undo_retype,
)
from parfocal_api.review_order import Results
from parfocal_api.review_order import read_chunk as read_cell_chunk
from parfocal_api.reviewed_layer import KINDS, UnknownObjectError, ai_object, assigned_slide
from parfocal_api.tables import (
    AnnotationKind,
    DecisionStyle,
    DecisionValue,
    result_chunks,
    result_objects,
    result_set_classes,
    review_decisions,
    review_skips,
)
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.result_store import ResultStore

MOST_OBJECTS = 5000
ROWS_PER_INSERT = 1000

OPEN_ONLY = (
    "Saves a decision for each object that has none yet from this reviewer, in one "
    "transaction, and leaves objects already decided as they are. Returns the decisions it saved."
)


class BatchDecisionDraft(BaseModel):
    object: str
    answer: Answer | None = None
    answer_class_id: uuid.UUID | None = None
    value: DecisionValue | None = None
    ai_class_id: uuid.UUID | None = None
    ai_score: Score | None = None

    @model_validator(mode="after")
    def one_answer(self) -> BatchDecisionDraft:
        if (self.answer is None) == (self.value is None):
            raise ValueError("Give the answer as pressed, or a value on an agree task")
        return self

    @property
    def pressed(self) -> str:
        return self.answer if self.answer is not None else str(self.value)


class DecisionBatch(BaseModel):
    decisions: list[BatchDecisionDraft] = Field(min_length=1, max_length=MOST_OBJECTS)


class DecisionClearBatch(BaseModel):
    objects: list[str] = Field(min_length=1, max_length=MOST_OBJECTS)


router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/decisions", tags=["review-tasks"]
)


type Key = tuple[AnnotationKind, int]


def key_of(found: ObjectId) -> Key:
    return KINDS[found.letter], found.number


def parsed_each(texts: Iterable[str]) -> list[Key]:
    return [key_of(ai_object(text)) for text in texts]


def parsed(texts: Iterable[str]) -> dict[Key, ObjectId]:
    return {key_of(found): found for found in map(ai_object, texts)}


async def lock_objects(
    connection: AsyncConnection,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    user_id: uuid.UUID | None,
    keys: Iterable[tuple[AnnotationKind, int]],
) -> None:
    names = sorted(
        f"review-object:{task_id}:{slide_id}:{user_id}:{kind}:{number}" for kind, number in keys
    )
    held = func.unnest(bindparam("names", names, type_=ARRAY(Text))).table_valued("name")
    await connection.execute(
        select(func.pg_advisory_xact_lock(func.hashtextextended(held.c.name, 0))).select_from(held)
    )


async def cell_classes(
    connection: AsyncConnection, store: ResultStore, result_set_id: uuid.UUID, numbers: set[int]
) -> dict[int, int]:
    left = set(numbers)
    found: dict[int, int] = {}
    if not left:
        return found
    keys = await connection.scalars(
        select(result_chunks.c.object_key)
        .where(result_chunks.c.result_set_id == result_set_id)
        .order_by(result_chunks.c.chunk)
    )
    for object_key in list(keys):
        chunk = await read_cell_chunk(store, object_key)
        for number, position in zip(chunk.numbers, chunk.classes, strict=True):
            if number in left:
                found[number] = position
                left.discard(number)
        if not left:
            break
    if left:
        raise UnknownObjectError(f"C{min(left)} is not in this result set")
    return found


async def region_calls(
    connection: AsyncConnection, result_set_id: uuid.UUID, numbers: set[int]
) -> dict[int, tuple[int | None, int | None]]:
    if not numbers:
        return {}
    rows = await connection.execute(
        select(result_objects.c.number, result_objects.c.class_index, result_objects.c.score).where(
            result_objects.c.result_set_id == result_set_id,
            result_objects.c.kind == "region",
            result_objects.c.number.in_(numbers),
        )
    )
    found = {row.number: (row.class_index, row.score) for row in rows}
    missing = numbers - set(found)
    if missing:
        raise UnknownObjectError(f"T{min(missing)} is not in this result set")
    return found


async def set_classes(
    connection: AsyncConnection, result_set_id: uuid.UUID
) -> dict[int, uuid.UUID]:
    rows = await connection.execute(
        select(result_set_classes.c.position, result_set_classes.c.class_id).where(
            result_set_classes.c.result_set_id == result_set_id
        )
    )
    return {row.position: row.class_id for row in rows}


class AiCalls:
    def __init__(
        self,
        classes: dict[int, uuid.UUID],
        cells: dict[int, int],
        regions: dict[int, tuple[int | None, int | None]],
    ) -> None:
        self.classes = classes
        self.cells = cells
        self.regions = regions

    def ai_class(self, kind: AnnotationKind, number: int) -> uuid.UUID | None:
        position = (
            self.cells.get(number) if kind is AnnotationKind.CELL else self.regions[number][0]
        )
        return self.classes.get(position) if position is not None else None

    def call(
        self, kind: AnnotationKind, number: int, draft: BatchDecisionDraft
    ) -> tuple[uuid.UUID | None, int | None]:
        if kind is AnnotationKind.REGION:
            return self.ai_class(kind, number), self.regions[number][1]
        if draft.ai_class_id is not None and draft.ai_class_id not in self.classes.values():
            raise NotASetClassError
        return draft.ai_class_id, draft.ai_score


async def ai_calls(
    connection: AsyncConnection,
    store: ResultStore,
    row: Any,
    keys: dict[tuple[AnnotationKind, int], ObjectId],
) -> AiCalls:
    if row.result_set_id is None:
        for found in keys.values():
            await require_ai_object(connection, store, row, found)
        return AiCalls(
            {}, {}, {number: (None, None) for kind, number in keys if kind is AnnotationKind.REGION}
        )
    numbers = {
        letter: {item.number for item in keys.values() if item.letter is letter}
        for letter in Letter
    }
    return AiCalls(
        await set_classes(connection, row.result_set_id),
        await cell_classes(connection, store, row.result_set_id, numbers[Letter.CELL]),
        await region_calls(connection, row.result_set_id, numbers[Letter.REGION]),
    )


def in_batches(rows: Sequence[dict[str, Any]]) -> Iterable[Sequence[dict[str, Any]]]:
    for start in range(0, len(rows), ROWS_PER_INSERT):
        yield rows[start : start + ROWS_PER_INSERT]


def objects_of(table: Any, keys: Iterable[tuple[AnnotationKind, int]]) -> Any:
    return tuple_(table.c.kind, table.c.number).in_([(str(kind), number) for kind, number in keys])


@router.post(
    "/batch",
    operation_id="saveDecisionBatch",
    description=OPEN_ONLY,
    **require(Permission.REVIEW, write=True),
)
async def save_decision_batch(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    batch: DecisionBatch,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> list[ReviewDecision]:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    await require_judging_allowed(connection, principal, row.project_id, task_id, slide_id)
    keys = parsed(draft.object for draft in batch.decisions)
    drafts = dict(
        zip(parsed_each(draft.object for draft in batch.decisions), batch.decisions, strict=True)
    )
    me = user_of(principal)
    await lock_objects(connection, task_id, slide_id, me, keys)
    style = DecisionStyle(row.decision_style)
    for draft in drafts.values():
        answer_in_style(style, draft.pressed, draft.answer_class_id)
    picked = {draft.answer_class_id for draft in drafts.values() if draft.answer_class_id}
    await check_classes(connection, row.project_id, picked)
    calls = await ai_calls(connection, results, row, keys)
    preset = await preset_in_force(connection, task_id, me)
    rows: list[dict[str, Any]] = []
    for (kind, number), draft in drafts.items():
        ai_class_id, ai_score = calls.call(kind, number, draft)
        ai_class = calls.ai_class(kind, number) if draft.answer_class_id is not None else None
        rows.append(
            {
                "tenant_id": row.tenant_id,
                "project_id": row.project_id,
                "task_id": task_id,
                "slide_id": slide_id,
                "user_id": me,
                "kind": kind,
                "number": number,
                "ai_class_id": ai_class_id,
                "ai_score": ai_score,
                "value": counted(
                    style, draft.pressed, row.counts_as, draft.answer_class_id, ai_class
                ),
                "style": style,
                "answer": draft.pressed,
                "answer_class_id": draft.answer_class_id,
                "reasons": [],
                "reason_class_id": None,
                "note": None,
                "preset": preset,
            }
        )
    saved: list[Any] = []
    for part in in_batches(rows):
        inserted = await connection.execute(
            upsert(review_decisions)
            .values(list(part))
            .on_conflict_do_nothing(
                index_elements=[
                    review_decisions.c.task_id,
                    review_decisions.c.slide_id,
                    review_decisions.c.user_id,
                    review_decisions.c.kind,
                    review_decisions.c.number,
                ]
            )
            .returning(review_decisions)
        )
        saved.extend(inserted.all())
    saved.sort(key=lambda item: (item.kind, item.number))
    done = [(AnnotationKind(item.kind), item.number) for item in saved]
    if done:
        await connection.execute(
            delete(review_skips).where(
                review_skips.c.task_id == task_id,
                review_skips.c.slide_id == slide_id,
                review_skips.c.user_id == me,
                objects_of(review_skips, done),
            )
        )
    await record_each(
        connection,
        actor_of(principal),
        AuditAction.REVIEW_OBJECT_DECIDED,
        AuditTarget.REVIEW_TASK,
        task_id,
        tenant_id=row.tenant_id,
        details=[
            {
                "slide_id": str(slide_id),
                "object": keys[(AnnotationKind(item.kind), item.number)].text(ascii=True),
                "style": style.value,
                "answer": item.answer,
                "value": DecisionValue(item.value).value,
                "reasons": [],
                "mentions": 0,
                "batch": True,
                **ai_details(item.ai_class_id, item.ai_score),
            }
            for item in saved
        ],
    )
    return [review_decision_of(item) for item in saved]


@router.post(
    "/batch-clear",
    operation_id="clearDecisionBatch",
    status_code=204,
    **require(Permission.REVIEW, write=True),
)
async def clear_decision_batch(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    batch: DecisionClearBatch,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Response:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    await require_judging_allowed(connection, principal, row.project_id, task_id, slide_id)
    keys = parsed(batch.objects)
    me = user_of(principal)
    await lock_objects(connection, task_id, slide_id, me, keys)
    cleared = await connection.execute(
        delete(review_decisions)
        .where(
            review_decisions.c.task_id == task_id,
            review_decisions.c.slide_id == slide_id,
            review_decisions.c.user_id == me,
            objects_of(review_decisions, keys),
        )
        .returning(
            review_decisions.c.kind, review_decisions.c.number, review_decisions.c.reason_class_id
        )
    )
    gone = sorted(cleared.all(), key=lambda item: (item.kind, item.number))
    for item in gone:
        if item.reason_class_id is not None:
            await undo_retype(
                connection, row, me, AnnotationKind(item.kind), item.number, item.reason_class_id
            )
    await record_each(
        connection,
        actor_of(principal),
        AuditAction.REVIEW_OBJECT_DECISION_CLEARED,
        AuditTarget.REVIEW_TASK,
        task_id,
        tenant_id=row.tenant_id,
        details=[
            {
                "slide_id": str(slide_id),
                "object": keys[(AnnotationKind(item.kind), item.number)].text(ascii=True),
                "batch": True,
            }
            for item in gone
        ],
    )
    return Response(status_code=204)
