import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import review_assignments, review_task_slides


async def slides_left_by_reviewer(
    connection: AsyncConnection, task_id: uuid.UUID
) -> dict[uuid.UUID, int]:
    rows = await connection.execute(
        select(review_assignments.c.user_id, func.count())
        .join(
            review_task_slides,
            (review_task_slides.c.task_id == review_assignments.c.task_id)
            & (review_task_slides.c.slide_id == review_assignments.c.slide_id),
        )
        .where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.released_at.is_(None),
            review_assignments.c.submitted_at.is_(None),
        )
        .group_by(review_assignments.c.user_id)
    )
    return {user_id: int(count) for user_id, count in rows}
