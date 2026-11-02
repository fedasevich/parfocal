import uuid
from collections.abc import Sequence
from datetime import datetime
from types import SimpleNamespace
from typing import Annotated, Any

from fastapi import APIRouter, Response
from pydantic import BaseModel, StringConstraints, model_validator
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import check_classes
from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import require_judging_allowed, require_seeing_reviewer, user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.decision_styles import (
    BlindCellsUnsupportedError,
    answer_in_style,
    counted,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import BadRequestError
from parfocal_api.reviewed_layer import (
    KINDS,
    ai_object,
    assigned_slide,
    check_exists,
    task_slide,
)
from parfocal_api.tables import (
    AnnotationKind,
    DecisionStyle,
    VerdictReason,
    VerdictValue,
    result_objects,
    result_set_classes,
    review_edits,
    verdicts,
)
from parfocal_common.object_ids import Letter, ObjectId

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


class VerdictDraft(BaseModel):
    answer: Answer | None = None
    answer_class_id: uuid.UUID | None = None
    value: VerdictValue | None = None
    reasons: list[VerdictReason] = []
    reason_class_id: uuid.UUID | None = None
    note: Note | None = None

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


class ReasonNotForAnswerError(BadRequestError):
    code = "reason-not-for-answer"
    title = "This reason does not go with an answer that counts this way"


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
    return changed, dropped


@router.put("/{object_id}", operation_id="saveVerdict", **require(Permission.REVIEW, write=True))
async def save_verdict(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: VerdictDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Verdict:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    await require_judging_allowed(connection, principal, row.project_id, task_id, slide_id)
    found = ai_object(object_id)
    kind = KINDS[found.letter]
    style = DecisionStyle(row.decision_style)
    answer = draft.pressed
    answer_in_style(style, answer, draft.answer_class_id)
    await check_exists(connection, row, found)
    ai_class = None
    if draft.answer_class_id is not None:
        if kind is not AnnotationKind.REGION:
            raise BlindCellsUnsupportedError
        await check_classes(connection, row.project_id, {draft.answer_class_id})
        ai_class = await ai_region_class(connection, row.result_set_id, found.number)
    value = counted(style, answer, row.counts_as, draft.answer_class_id, ai_class)
    check_reasons(value, kind, draft.reasons)
    if draft.reason_class_id is not None:
        await check_classes(connection, row.project_id, {draft.reason_class_id})
    me = user_of(principal)
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
    }
    await connection.execute(
        upsert(verdicts)
        .values(
            tenant_id=row.tenant_id,
            project_id=row.project_id,
            task_id=task_id,
            slide_id=slide_id,
            user_id=me,
            kind=kind,
            number=found.number,
            **values,
        )
        .on_conflict_do_update(
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
    if previous is not None and previous.reason_class_id not in {None, draft.reason_class_id}:
        await undo_retype(connection, row, me, kind, found.number, previous.reason_class_id)
    if draft.reason_class_id is not None:
        await retype(connection, row, me, kind, found.number, draft.reason_class_id)
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
        },
    )
    saved = (
        await connection.execute(
            select(verdicts).where(
                *same_object(verdicts, task_id, slide_id, me, kind, found.number)
            )
        )
    ).one()
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
    row = await task_slide(connection, principal, task_id, slide_id)
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
