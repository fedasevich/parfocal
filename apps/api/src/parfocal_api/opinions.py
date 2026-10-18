import uuid
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.opinion_questions import (
    QUESTIONS,
    ChoiceQuestion,
    Question,
    ScaleQuestion,
    TextQuestion,
    YesNoQuestion,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import BadRequestError, ConflictError
from parfocal_api.project_access import project_grant, reads_whole
from parfocal_api.reviewed_layer import OtherReviewerError, assigned_slide, task_slide, user_of
from parfocal_api.tables import opinion_forms, opinions, review_assignments, review_tasks

MAX_ANSWERS = 12


class OpinionChange(BaseModel):
    answers: Annotated[dict[str, Any], Field(max_length=MAX_ANSWERS)]


class Opinion(BaseModel):
    reviewer_id: uuid.UUID
    form_version: int
    questions: list[Question]
    answers: dict[str, Any]
    draft: bool
    updated_at: datetime | None


class InvalidAnswerError(BadRequestError):
    code = "invalid-answer"
    title = "An answer does not fit its question"


class ReviewSubmittedError(ConflictError):
    code = "already-submitted"
    title = "This slide is submitted. Reopen it to change the opinion"


router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/opinion", tags=["review-tasks"]
)


def answer_problem(question: Question, value: Any) -> str | None:
    match question:
        case ScaleQuestion():
            if isinstance(value, bool) or not isinstance(value, int):
                return "is a whole number"
            if not question.min <= value <= question.max:
                return f"is from {question.min} to {question.max}"
        case ChoiceQuestion():
            if value not in question.options:
                return "is one of the options"
        case YesNoQuestion():
            if not isinstance(value, bool):
                return "is yes or no"
        case TextQuestion():
            if not isinstance(value, str):
                return "is text"
            if len(value) > question.max_length:
                return f"has at most {question.max_length} characters"
    return None


def checked_answers(questions: Sequence[Question], answers: Mapping[str, Any]) -> None:
    by_key = {question.key: question for question in questions}
    for key, value in answers.items():
        question = by_key.get(key)
        if question is None:
            raise InvalidAnswerError(f"{key} is not a question of this form")
        if value is None:
            continue
        if (problem := answer_problem(question, value)) is not None:
            raise InvalidAnswerError(f"The answer to {question.label} {problem}")


async def form_of(connection: AsyncConnection, task_id: uuid.UUID) -> tuple[int, list[Question]]:
    row = (
        await connection.execute(
            select(opinion_forms.c.version, opinion_forms.c.questions)
            .join(
                review_tasks,
                (review_tasks.c.project_id == opinion_forms.c.project_id)
                & (review_tasks.c.opinion_form_version == opinion_forms.c.version),
            )
            .where(review_tasks.c.id == task_id)
        )
    ).one()
    return int(row.version), QUESTIONS.validate_python(row.questions)


async def opinion_of(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, reviewer: uuid.UUID
) -> Opinion:
    version, questions = await form_of(connection, task_id)
    stored = (
        await connection.execute(
            select(opinions.c.answers, opinions.c.updated_at).where(
                opinions.c.task_id == task_id,
                opinions.c.slide_id == slide_id,
                opinions.c.user_id == reviewer,
            )
        )
    ).one_or_none()
    submitted_at = await connection.scalar(
        select(review_assignments.c.submitted_at).where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.slide_id == slide_id,
            review_assignments.c.user_id == reviewer,
        )
    )
    return Opinion(
        reviewer_id=reviewer,
        form_version=version,
        questions=questions,
        answers=dict(stored.answers) if stored else {},
        draft=submitted_at is None,
        updated_at=stored.updated_at if stored else None,
    )


@router.put("", operation_id="saveOpinion", **require(Permission.REVIEW, write=True))
async def save_opinion(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    change: OpinionChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Opinion:
    row = await assigned_slide(connection, principal, task_id, slide_id)
    me = user_of(principal)
    assert me is not None
    current = await opinion_of(connection, task_id, slide_id, me)
    if not current.draft:
        raise ReviewSubmittedError
    checked_answers(current.questions, change.answers)
    merged = {
        key: value
        for key, value in {**current.answers, **change.answers}.items()
        if value is not None
    }
    await connection.execute(
        upsert(opinions)
        .values(
            tenant_id=row.tenant_id,
            project_id=row.project_id,
            task_id=task_id,
            slide_id=slide_id,
            user_id=me,
            form_version=current.form_version,
            answers=merged,
        )
        .on_conflict_do_update(
            index_elements=[opinions.c.task_id, opinions.c.slide_id, opinions.c.user_id],
            set_={"answers": merged},
        )
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.REVIEW_OPINION_SAVED,
        AuditTarget.REVIEW_TASK,
        task_id,
        tenant_id=row.tenant_id,
        details={"slide_id": str(slide_id), "questions": sorted(change.answers)},
    )
    return await opinion_of(connection, task_id, slide_id, me)


@router.get("", operation_id="getOpinion", **require(Permission.SEE_SLIDES, emergency=True))
async def get_opinion(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    reviewer_id: uuid.UUID | None = None,
) -> Opinion:
    row = await task_slide(connection, principal, task_id, slide_id)
    reviewer = reviewer_id or user_of(principal)
    if reviewer is None:
        raise BadRequestError("Name the reviewer")
    if reviewer != user_of(principal) and not reads_whole(
        await project_grant(connection, principal, row.project_id, Permission.SEE_SLIDES)
    ):
        raise OtherReviewerError
    return await opinion_of(connection, task_id, slide_id, reviewer)
