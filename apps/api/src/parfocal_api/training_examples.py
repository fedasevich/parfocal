import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import VerdictReason, VerdictValue, review_edits, verdicts

LEARNED_VALUES = frozenset({VerdictValue.AGREE, VerdictValue.DISAGREE})


@dataclass(frozen=True)
class ReviewedDecision:
    tenant_id: uuid.UUID
    project_id: uuid.UUID
    task_id: uuid.UUID
    slide_id: uuid.UUID
    reviewer_id: uuid.UUID | None
    kind: str
    number: int
    value: str
    reasons: Sequence[str]
    reason_class_id: uuid.UUID | None
    answer_class_id: uuid.UUID | None
    ai_class_id: uuid.UUID | None
    ai_score: int | None
    reopened: bool
    edited_class_id: uuid.UUID | None = None
    edited_geometry: dict[str, Any] | None = None
    edit_deleted: bool = False


@dataclass(frozen=True)
class ReviewSkip:
    task_id: uuid.UUID
    slide_id: uuid.UUID
    reviewer_id: uuid.UUID
    kind: str
    number: int


@dataclass(frozen=True)
class PlainRecolour:
    annotation_id: uuid.UUID
    changed_by_user_id: uuid.UUID | None
    class_id: uuid.UUID | None


type CorrectionEvent = ReviewedDecision | ReviewSkip | PlainRecolour


@dataclass(frozen=True)
class TrainingExample:
    tenant_id: uuid.UUID
    project_id: uuid.UUID
    task_id: uuid.UUID
    slide_id: uuid.UUID
    reviewer_id: uuid.UUID
    kind: str
    number: int
    decision: VerdictValue
    reasons: tuple[str, ...]
    ai_class_id: uuid.UUID | None
    ai_score: int | None
    final_class_id: uuid.UUID | None
    geometry: dict[str, Any] | None
    rejected: bool


def final_class_of(decision: ReviewedDecision, value: VerdictValue) -> uuid.UUID | None:
    if decision.edited_class_id is not None:
        return decision.edited_class_id
    if value is VerdictValue.AGREE:
        return decision.ai_class_id
    if decision.answer_class_id is not None:
        return decision.answer_class_id
    if VerdictReason.WRONG_CLASS in decision.reasons:
        return decision.reason_class_id
    return None


def example_of(event: CorrectionEvent) -> TrainingExample | None:
    if not isinstance(event, ReviewedDecision):
        return None
    if event.reviewer_id is None or event.reopened or event.value not in LEARNED_VALUES:
        return None
    value = VerdictValue(event.value)
    final_class = final_class_of(event, value)
    reshaped = event.edited_geometry is not None
    return TrainingExample(
        tenant_id=event.tenant_id,
        project_id=event.project_id,
        task_id=event.task_id,
        slide_id=event.slide_id,
        reviewer_id=event.reviewer_id,
        kind=event.kind,
        number=event.number,
        decision=value,
        reasons=tuple(sorted(event.reasons)),
        ai_class_id=event.ai_class_id,
        ai_score=event.ai_score,
        final_class_id=final_class,
        geometry=event.edited_geometry,
        rejected=value is VerdictValue.DISAGREE
        and (event.edit_deleted or (final_class is None and not reshaped)),
    )


def examples_of(events: Sequence[CorrectionEvent]) -> list[TrainingExample]:
    return [example for event in events if (example := example_of(event)) is not None]


def decision_columns() -> list[Any]:
    return [
        verdicts.c.tenant_id,
        verdicts.c.project_id,
        verdicts.c.task_id,
        verdicts.c.slide_id,
        verdicts.c.user_id,
        verdicts.c.kind,
        verdicts.c.number,
        verdicts.c.value,
        verdicts.c.reasons,
        verdicts.c.reason_class_id,
        verdicts.c.answer_class_id,
        verdicts.c.ai_class_id,
        verdicts.c.ai_score,
        verdicts.c.reopened_at,
        review_edits.c.class_id.label("edited_class_id"),
        func.ST_AsGeoJSON(review_edits.c.geometry).label("edited_geojson"),
        review_edits.c.deleted.label("edit_deleted"),
    ]


async def reviewed_decisions(
    connection: AsyncConnection, project_id: uuid.UUID, task_id: uuid.UUID | None = None
) -> list[ReviewedDecision]:
    edit = and_(
        review_edits.c.task_id == verdicts.c.task_id,
        review_edits.c.slide_id == verdicts.c.slide_id,
        review_edits.c.user_id == verdicts.c.user_id,
        review_edits.c.kind == verdicts.c.kind,
        review_edits.c.number == verdicts.c.number,
        review_edits.c.split == "",
    )
    query = (
        select(*decision_columns())
        .select_from(verdicts.outerjoin(review_edits, edit))
        .where(verdicts.c.project_id == project_id)
        .order_by(verdicts.c.task_id, verdicts.c.slide_id, verdicts.c.kind, verdicts.c.number)
    )
    if task_id is not None:
        query = query.where(verdicts.c.task_id == task_id)
    rows = (await connection.execute(query)).all()
    return [
        ReviewedDecision(
            tenant_id=row.tenant_id,
            project_id=row.project_id,
            task_id=row.task_id,
            slide_id=row.slide_id,
            reviewer_id=row.user_id,
            kind=row.kind,
            number=row.number,
            value=row.value,
            reasons=list(row.reasons),
            reason_class_id=row.reason_class_id,
            answer_class_id=row.answer_class_id,
            ai_class_id=row.ai_class_id,
            ai_score=row.ai_score,
            reopened=row.reopened_at is not None,
            edited_class_id=row.edited_class_id,
            edited_geometry=json.loads(row.edited_geojson) if row.edited_geojson else None,
            edit_deleted=bool(row.edit_deleted),
        )
        for row in rows
    ]


async def training_examples(
    connection: AsyncConnection, project_id: uuid.UUID, task_id: uuid.UUID | None = None
) -> list[TrainingExample]:
    return examples_of(await reviewed_decisions(connection, project_id, task_id))
