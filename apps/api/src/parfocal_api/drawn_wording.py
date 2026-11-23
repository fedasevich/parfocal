import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.opinion_questions import Question
from parfocal_api.tables import ResultSource, result_sets, review_task_slides

WHOLE = {
    "Is the AI result acceptable for this slide?": (
        "Are the drawn outlines acceptable for this slide?"
    ),
    "Is the AI result acceptable?": "Are the drawn outlines acceptable?",
    "Did the AI change your answer?": "Did the drawn outlines change your answer?",
}

PHRASES = (
    (re.compile(r"\bIs the AI result\b"), "Are the drawn outlines"),
    (re.compile(r"\bis the AI result\b"), "are the drawn outlines"),
    (re.compile(r"\bIs the AI\b"), "Are the drawn outlines"),
    (re.compile(r"\bDoes the AI\b"), "Do the drawn outlines"),
    (re.compile(r"\bthe AI result\b"), "the drawn outlines"),
    (re.compile(r"\bThe AI result\b"), "The drawn outlines"),
    (re.compile(r"\bthe AI's\b"), "the drawn"),
    (re.compile(r"\bThe AI's\b"), "The drawn"),
    (re.compile(r"\bthe AI\b"), "the drawn outlines"),
    (re.compile(r"\bThe AI\b"), "The drawn outlines"),
)


def drawn_text(text: str) -> str:
    if text in WHOLE:
        return WHOLE[text]
    for pattern, replacement in PHRASES:
        text = pattern.sub(replacement, text)
    return text


def drawn_questions(questions: list[Question]) -> list[Question]:
    return [
        question.model_copy(update={"label": drawn_text(question.label)}) for question in questions
    ]


async def drawn_only(connection: AsyncConnection, task_id: uuid.UUID) -> bool:
    rows = await connection.execute(
        select(result_sets.c.source, func.count())
        .select_from(review_task_slides)
        .join(result_sets, result_sets.c.id == review_task_slides.c.result_set_id)
        .where(review_task_slides.c.task_id == task_id)
        .group_by(result_sets.c.source)
    )
    sources = {row[0] for row in rows}
    return sources == {ResultSource.DRAWN}
