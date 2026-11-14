import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.opinion_questions import asked_in
from parfocal_api.opinions import opinion_of
from parfocal_api.problems import ConflictError
from parfocal_api.reviewed_layer import KINDS
from parfocal_api.tables import review_decisions, review_edits, review_order
from parfocal_common.object_ids import ObjectId
from parfocal_common.review_order import unpack


class ReviewNotDoneError(ConflictError):
    code = "review-not-done"
    title = "Decide every object and answer the required questions before you submit"

    def __init__(self, open_objects: list[str], unanswered_questions: list[str]) -> None:
        parts = [
            *([f"Still open: {', '.join(open_objects)}."] if open_objects else []),
            *(
                [f"Not answered: {', '.join(unanswered_questions)}."]
                if unanswered_questions
                else []
            ),
        ]
        super().__init__(" ".join(parts))
        self.current = {
            "open_objects": open_objects,
            "unanswered_questions": unanswered_questions,
        }


async def open_objects(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, reviewer: uuid.UUID
) -> list[str]:
    packed = await connection.scalar(
        select(review_order.c.objects).where(
            review_order.c.task_id == task_id, review_order.c.slide_id == slide_id
        )
    )
    if packed is None:
        return []
    decided = {
        (row.kind, row.number)
        for row in await connection.execute(
            select(review_decisions.c.kind, review_decisions.c.number).where(
                review_decisions.c.task_id == task_id,
                review_decisions.c.slide_id == slide_id,
                review_decisions.c.user_id == reviewer,
            )
        )
    } | {
        (row.kind, row.number)
        for row in await connection.execute(
            select(review_edits.c.kind, review_edits.c.number).where(
                review_edits.c.task_id == task_id,
                review_edits.c.slide_id == slide_id,
                review_edits.c.user_id == reviewer,
                review_edits.c.split == "",
                review_edits.c.deleted.is_(True),
            )
        )
    }
    return [
        ObjectId(letter, number).text(ascii=True)
        for letter, number in unpack(bytes(packed))
        if (KINDS[letter], number) not in decided
    ]


async def unanswered_questions(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, reviewer: uuid.UUID
) -> list[str]:
    opinion = await opinion_of(connection, task_id, slide_id, reviewer)
    return [
        question.key
        for question in opinion.questions
        if question.required
        and asked_in(question, opinion.read)
        and opinion.answers.get(question.key) in (None, "")
    ]


async def require_done(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, reviewer: uuid.UUID
) -> None:
    objects = await open_objects(connection, task_id, slide_id, reviewer)
    questions = await unanswered_questions(connection, task_id, slide_id, reviewer)
    if objects or questions:
        raise ReviewNotDoneError(objects, questions)
