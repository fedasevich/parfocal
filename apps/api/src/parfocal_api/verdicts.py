import uuid
from collections.abc import Sequence
from datetime import datetime
from types import SimpleNamespace
from typing import Annotated, Any

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import check_classes
from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import require_judging_allowed, require_seeing_reviewer, user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.decision_notes import checked_note_mentions, tell_mentioned
from parfocal_api.decision_styles import answer_in_style, counted
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import BadRequestError
from parfocal_api.review_order import Results
from parfocal_api.review_order import read_chunk as read_cell_chunk
from parfocal_api.reviewed_layer import (
    KINDS,
    ai_object,
    assigned_slide,
    check_exists,
    review_slide,
)
from parfocal_api.tables import (
    AnnotationKind,
    DecisionStyle,
    VerdictReason,
    VerdictValue,
    disagreement_decisions,
    display_choices,
    display_presets,
    result_chunks,
    result_objects,
    result_set_classes,
    review_edits,
    review_skips,
    verdicts,
)
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.result_store import ResultStore

REASONS = {
    AnnotationKind.REGION: frozenset(
        {
            VerdictReason.NOT_CLASS,
            VerdictReason.BOUNDARY_OFF,
            VerdictReason.TWO_REGIONS,
            VerdictReason.ARTEFACT,
        }
    ),
    AnnotationKind.CELL: frozenset(
        {
            VerdictReason.NOT_A_CELL,
            VerdictReason.WRONG_CLASS,
            VerdictReason.BOUNDARY_OFF,
            VerdictReason.ARTEFACT,
        }
    ),
}

UNSURE_REASONS = frozenset(
    {
        VerdictReason.NEED_DEEPER_LEVEL,
        VerdictReason.NEED_IHC,
        VerdictReason.BORDER_UNCLEAR,
        VerdictReason.OUT_OF_FOCUS,
        VerdictReason.NEED_SECOND_LOOK,
    }
)

type Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


type Answer = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)]

type Score = Annotated[int, Field(ge=0, le=255)]

REPORTED_CALL = (
    "The AI call shown when deciding. For a cell the reviewer's client reports it and the API "
    "checks only that the class is one the result set uses, because cell calls live in the "
    "result chunks. For a region the API reads it from the result set and ignores this field."
)
SAVED_CALL = (
    "The AI call when the object was first decided, kept for as long as the decision exists. "
    "Reported by the client for cells and read from the result set for regions."
)


class VerdictDraft(BaseModel):
    answer: Answer | None = None
    answer_class_id: uuid.UUID | None = None
    value: VerdictValue | None = None
    reasons: list[VerdictReason] = []
    reason_class_id: uuid.UUID | None = None
    note: Note | None = None
    ai_class_id: uuid.UUID | None = Field(default=None, description=REPORTED_CALL)
    ai_score: Score | None = Field(default=None, description=REPORTED_CALL)

    @model_validator(mode="after")
    def reasons_fit_value(self) -> VerdictDraft:
        if (self.answer is None) == (self.value is None):
            raise ValueError("Give the answer as pressed, or a value on an agree task")
        self.reasons = sorted(set(self.reasons))
        if (VerdictReason.WRONG_CLASS in self.reasons) != (self.reason_class_id is not None):
            raise ValueError("Wrong class names the right class, and only it does")
        return self

    @property
    def pressed(self) -> str:
        return self.answer if self.answer is not None else str(self.value)


class Verdict(BaseModel):
    object: str
    kind: AnnotationKind
    number: int
    style: DecisionStyle
    answer: str
    answer_class_id: uuid.UUID | None
    value: VerdictValue
    reasons: list[VerdictReason]
    reason_class_id: uuid.UUID | None
    note: str | None
    updated_at: datetime
    reopened_at: datetime | None = None
    reopened_note: str | None = None
    preset: str | None = None
    ai_class_id: uuid.UUID | None = Field(default=None, description=SAVED_CALL)
    ai_score: int | None = Field(default=None, description=SAVED_CALL)


class ReasonNotForAnswerError(BadRequestError):
    code = "reason-not-for-answer"
    title = "This reason does not go with an answer that counts this way"


class NotASetClassError(BadRequestError):
    code = "not-a-set-class"
    title = "The AI call names a class this result set does not use"


class ReasonNotForKindError(BadRequestError):
    code = "reason-not-for-kind"
    title = "This reason does not apply to this kind of object"


router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/verdicts", tags=["review-tasks"]
)


def verdict_of(row: Any) -> Verdict:
    kind = AnnotationKind(row.kind)
    letter = Letter.REGION if kind is AnnotationKind.REGION else Letter.CELL
    return Verdict(
        object=ObjectId(letter, row.number).text(ascii=True),
        kind=kind,
        number=row.number,
        style=DecisionStyle(row.style),
        answer=row.answer,
        answer_class_id=row.answer_class_id,
        value=VerdictValue(row.value),
        reasons=[VerdictReason(code) for code in row.reasons],
        reason_class_id=row.reason_class_id,
        note=row.note,
        updated_at=row.updated_at,
        reopened_at=row.reopened_at,
        reopened_note=row.reopened_note,
        preset=row.preset,
        ai_class_id=row.ai_class_id,
        ai_score=row.ai_score,
    )


def check_reasons(value: VerdictValue, kind: AnnotationKind, reasons: list[VerdictReason]) -> None:
    if value is VerdictValue.AGREE and reasons:
        raise ReasonNotForAnswerError("An answer that counts as agree takes no reason")
    if value is VerdictValue.UNSURE and not UNSURE_REASONS.issuperset(reasons):
        raise ReasonNotForAnswerError("An answer that counts as not sure takes only those reasons")
    if value is VerdictValue.DISAGREE:
        for reason in reasons:
            if reason not in REASONS[kind]:
                raise ReasonNotForKindError(f"{reason} is not a reason for a {kind}")


async def ai_region_class(
    connection: AsyncConnection, result_set_id: uuid.UUID, number: int
) -> uuid.UUID | None:
    found = await connection.scalar(
        select(result_set_classes.c.class_id)
        .join(
            result_objects,
            (result_objects.c.result_set_id == result_set_classes.c.result_set_id)
            & (result_objects.c.class_index == result_set_classes.c.position),
        )
        .where(
            result_objects.c.result_set_id == result_set_id,
            result_objects.c.kind == "region",
            result_objects.c.number == number,
        )
    )
    return found if isinstance(found, uuid.UUID) else None


async def ai_cell_class(
    connection: AsyncConnection, store: ResultStore, result_set_id: uuid.UUID, number: int
) -> uuid.UUID | None:
    keys = await connection.scalars(
        select(result_chunks.c.object_key)
        .where(result_chunks.c.result_set_id == result_set_id)
        .order_by(result_chunks.c.chunk)
    )
    for object_key in keys:
        chunk = await read_cell_chunk(store, object_key)
        numbers = list(chunk.numbers)
        if number in numbers:
            found = await connection.scalar(
                select(result_set_classes.c.class_id).where(
                    result_set_classes.c.result_set_id == result_set_id,
                    result_set_classes.c.position == chunk.classes[numbers.index(number)],
                )
            )
            return found if isinstance(found, uuid.UUID) else None
    return None


async def ai_class_of(
    connection: AsyncConnection,
    store: ResultStore,
    result_set_id: uuid.UUID,
    kind: AnnotationKind,
    number: int,
) -> uuid.UUID | None:
    if kind is AnnotationKind.REGION:
        return await ai_region_class(connection, result_set_id, number)
    return await ai_cell_class(connection, store, result_set_id, number)


async def ai_call(
    connection: AsyncConnection,
    row: Any,
    kind: AnnotationKind,
    number: int,
    shown_class_id: uuid.UUID | None,
    shown_score: int | None,
) -> tuple[uuid.UUID | None, int | None]:
    if kind is AnnotationKind.REGION:
        found = (
            await connection.execute(
                select(result_set_classes.c.class_id, result_objects.c.score)
                .select_from(result_objects)
                .outerjoin(
                    result_set_classes,
                    (result_set_classes.c.result_set_id == result_objects.c.result_set_id)
                    & (result_set_classes.c.position == result_objects.c.class_index),
                )
                .where(
                    result_objects.c.result_set_id == row.result_set_id,
                    result_objects.c.kind == "region",
                    result_objects.c.number == number,
                )
            )
        ).one_or_none()
        return (found.class_id, found.score) if found is not None else (None, None)
    if shown_class_id is not None:
        used = select(result_set_classes).where(
            result_set_classes.c.result_set_id == row.result_set_id,
            result_set_classes.c.class_id == shown_class_id,
        )
        if not await connection.scalar(select(used.exists())):
            raise NotASetClassError
    return shown_class_id, shown_score


async def lock_object(
    connection: AsyncConnection,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    user_id: uuid.UUID | None,
    kind: AnnotationKind,
    number: int,
) -> None:
    key = f"review-object:{task_id}:{slide_id}:{user_id}:{kind}:{number}"
    await connection.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(key, 0))))


def ai_details(class_id: uuid.UUID | None, score: int | None) -> dict[str, Any]:
    return {"ai_class_id": str(class_id) if class_id else None, "ai_score": score}


def same_object(
    table: Any,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    user_id: uuid.UUID | None,
    kind: AnnotationKind,
    number: int,
) -> list[Any]:
    return [
        table.c.task_id == task_id,
        table.c.slide_id == slide_id,
        table.c.user_id == user_id,
        table.c.kind == kind,
        table.c.number == number,
    ]


async def retype(
    connection: AsyncConnection,
    row: Any,
    user_id: uuid.UUID | None,
    kind: AnnotationKind,
    number: int,
    class_id: uuid.UUID,
) -> None:
    await connection.execute(
        upsert(review_edits)
        .values(
            tenant_id=row.tenant_id,
            project_id=row.project_id,
            task_id=row.task_id,
            slide_id=row.slide_id,
            user_id=user_id,
            kind=kind,
            number=number,
            class_id=class_id,
        )
        .on_conflict_do_update(
            index_elements=[
                review_edits.c.task_id,
                review_edits.c.slide_id,
                review_edits.c.user_id,
                review_edits.c.kind,
                review_edits.c.number,
                review_edits.c.split,
            ],
            set_={"class_id": class_id},
        )
    )


async def undo_retype(
    connection: AsyncConnection,
    row: Any,
    user_id: uuid.UUID | None,
    kind: AnnotationKind,
    number: int,
    class_id: uuid.UUID,
) -> None:
    where = [
        *same_object(review_edits, row.task_id, row.slide_id, user_id, kind, number),
        review_edits.c.class_id == class_id,
        review_edits.c.split == "",
    ]
    await connection.execute(
        delete(review_edits).where(
            *where, review_edits.c.geometry.is_(None), review_edits.c.deleted.is_(False)
        )
    )
    await connection.execute(update(review_edits).where(*where).values(class_id=None))


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    row: Any,
    details: dict[str, Any],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.REVIEW_TASK,
        row.task_id,
        tenant_id=row.tenant_id,
        details={"slide_id": str(row.slide_id), **details},
    )


def fitting(value: VerdictValue, kind: AnnotationKind, reasons: list[str]) -> list[str]:
    allowed = {
        VerdictValue.AGREE: frozenset[VerdictReason](),
        VerdictValue.UNSURE: UNSURE_REASONS,
        VerdictValue.DISAGREE: REASONS[kind],
    }[value]
    return [reason for reason in reasons if reason in allowed]


async def recount(
    connection: AsyncConnection, task: Any, counts_as: Sequence[str]
) -> tuple[int, int]:
    rows = (
        await connection.execute(
            select(verdicts).where(
                verdicts.c.task_id == task.id, verdicts.c.style == DecisionStyle.CERTAINTY
            )
        )
    ).all()
    changed = dropped = 0
    for row in rows:
        value = counted(DecisionStyle.CERTAINTY, row.answer, counts_as)
        if value == row.value:
            continue
        changed += 1
        kind = AnnotationKind(row.kind)
        reasons = fitting(value, kind, list(row.reasons))
        class_id = row.reason_class_id if VerdictReason.WRONG_CLASS in reasons else None
        dropped += len(row.reasons) - len(reasons)
        await connection.execute(
            update(verdicts)
            .where(*same_object(verdicts, task.id, row.slide_id, row.user_id, kind, row.number))
            .values(value=value, reasons=reasons, reason_class_id=class_id)
        )
        if row.reason_class_id is not None and class_id is None:
            layer = SimpleNamespace(
                tenant_id=row.tenant_id,
                project_id=row.project_id,
                task_id=task.id,
                slide_id=row.slide_id,
            )
            await undo_retype(connection, layer, row.user_id, kind, row.number, row.reason_class_id)
    await recount_queue_decisions(connection, task.id, counts_as)
    return changed, dropped


async def recount_queue_decisions(
    connection: AsyncConnection, task_id: uuid.UUID, counts_as: Sequence[str]
) -> None:
    for position, value in enumerate(counts_as, start=1):
        await connection.execute(
            update(disagreement_decisions)
            .where(
                disagreement_decisions.c.task_id == task_id,
                disagreement_decisions.c.style == DecisionStyle.CERTAINTY,
                disagreement_decisions.c.answer == str(position),
            )
            .values(value=value)
        )


async def preset_in_force(
    connection: AsyncConnection, task_id: uuid.UUID, user_id: uuid.UUID | None
) -> str | None:
    name = await connection.scalar(
        select(display_presets.c.name)
        .join(display_choices, display_choices.c.preset_id == display_presets.c.id)
        .where(display_choices.c.task_id == task_id, display_choices.c.user_id == user_id)
    )
    return name if isinstance(name, str) else None


@router.put("/{object_id}", operation_id="saveVerdict", **require(Permission.REVIEW, write=True))
async def save_verdict(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: VerdictDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> Verdict:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    await require_judging_allowed(connection, principal, row.project_id, task_id, slide_id)
    found = ai_object(object_id)
    kind = KINDS[found.letter]
    await lock_object(connection, task_id, slide_id, user_of(principal), kind, found.number)
    style = DecisionStyle(row.decision_style)
    answer = draft.pressed
    answer_in_style(style, answer, draft.answer_class_id)
    await check_exists(connection, row, found)
    ai_class = None
    if draft.answer_class_id is not None:
        await check_classes(connection, row.project_id, {draft.answer_class_id})
        ai_class = await ai_class_of(connection, results, row.result_set_id, kind, found.number)
    value = counted(style, answer, row.counts_as, draft.answer_class_id, ai_class)
    check_reasons(value, kind, draft.reasons)
    if draft.reason_class_id is not None:
        await check_classes(connection, row.project_id, {draft.reason_class_id})
    me = user_of(principal)
    mentioned = await checked_note_mentions(connection, principal, row, draft.note)
    ai_class_id, ai_score = await ai_call(
        connection, row, kind, found.number, draft.ai_class_id, draft.ai_score
    )
    previous = (
        await connection.execute(
            select(verdicts.c.reason_class_id).where(
                *same_object(verdicts, task_id, slide_id, me, kind, found.number)
            )
        )
    ).one_or_none()
    values = {
        "value": value,
        "style": style,
        "answer": answer,
        "answer_class_id": draft.answer_class_id,
        "reasons": [reason.value for reason in draft.reasons],
        "reason_class_id": draft.reason_class_id,
        "note": draft.note or None,
        "reopened_at": None,
        "reopened_note": None,
        "preset": await preset_in_force(connection, task_id, me),
    }
    saving = upsert(verdicts).values(
        tenant_id=row.tenant_id,
        project_id=row.project_id,
        task_id=task_id,
        slide_id=slide_id,
        user_id=me,
        kind=kind,
        number=found.number,
        ai_class_id=ai_class_id,
        ai_score=ai_score,
        **values,
    )
    await connection.execute(
        saving.on_conflict_do_update(
            index_elements=[
                verdicts.c.task_id,
                verdicts.c.slide_id,
                verdicts.c.user_id,
                verdicts.c.kind,
                verdicts.c.number,
            ],
            set_=values,
        )
    )
    await connection.execute(
        delete(review_skips).where(
            *same_object(review_skips, task_id, slide_id, me, kind, found.number)
        )
    )
    if previous is not None and previous.reason_class_id not in {None, draft.reason_class_id}:
        await undo_retype(connection, row, me, kind, found.number, previous.reason_class_id)
    if draft.reason_class_id is not None:
        await retype(connection, row, me, kind, found.number, draft.reason_class_id)
    saved = (
        await connection.execute(
            select(verdicts).where(
                *same_object(verdicts, task_id, slide_id, me, kind, found.number)
            )
        )
    ).one()
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_VERDICT_SET,
        row,
        {
            "object": found.text(ascii=True),
            "style": style.value,
            "answer": answer,
            "value": value.value,
            "reasons": [reason.value for reason in draft.reasons],
            "mentions": len(mentioned),
            **ai_details(saved.ai_class_id, saved.ai_score),
        },
    )
    await tell_mentioned(connection, row, saved)
    return verdict_of(saved)


@router.delete(
    "/{object_id}",
    operation_id="clearVerdict",
    status_code=204,
    **require(Permission.REVIEW, write=True),
)
async def clear_verdict(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Response:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    await require_judging_allowed(connection, principal, row.project_id, task_id, slide_id)
    found = ai_object(object_id)
    kind = KINDS[found.letter]
    me = user_of(principal)
    await lock_object(connection, task_id, slide_id, me, kind, found.number)
    cleared = (
        await connection.execute(
            delete(verdicts)
            .where(*same_object(verdicts, task_id, slide_id, me, kind, found.number))
            .returning(verdicts.c.reason_class_id)
        )
    ).one_or_none()
    if cleared is not None:
        if cleared.reason_class_id is not None:
            await undo_retype(connection, row, me, kind, found.number, cleared.reason_class_id)
        await audit(
            connection,
            principal,
            AuditAction.REVIEW_VERDICT_CLEARED,
            row,
            {"object": found.text(ascii=True)},
        )
    return Response(status_code=204)


@router.get("", operation_id="listVerdicts", **require(Permission.SEE_SLIDES, emergency=True))
async def list_verdicts(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    reviewer_id: uuid.UUID | None = None,
) -> list[Verdict]:
    row = await review_slide(connection, principal, task_id, slide_id)
    reviewer = reviewer_id or user_of(principal)
    if reviewer is None:
        raise BadRequestError("Name the reviewer")
    await require_seeing_reviewer(
        connection, principal, row.project_id, task_id, slide_id, reviewer
    )
    rows = await connection.execute(
        select(verdicts)
        .where(
            verdicts.c.task_id == task_id,
            verdicts.c.slide_id == slide_id,
            verdicts.c.user_id == reviewer,
        )
        .order_by(verdicts.c.kind, verdicts.c.number)
    )
    return [verdict_of(item) for item in rows]
