import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.object_ids import Letter

NEXT_NUMBERS = text(
    "INSERT INTO slide_counters (tenant_id, slide_id, letter, last) "
    "VALUES (:tenant_id, :slide_id, :letter, :count) "
    "ON CONFLICT (slide_id, letter) DO UPDATE SET last = slide_counters.last + EXCLUDED.last "
    "RETURNING last"
)


async def reserve(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    slide_id: uuid.UUID,
    letter: Letter,
    count: int,
) -> int:
    if count < 1:
        raise ValueError("Reserve at least one number")
    last = await connection.scalar(
        NEXT_NUMBERS,
        {"tenant_id": tenant_id, "slide_id": slide_id, "letter": letter.value, "count": count},
    )
    assert isinstance(last, int)
    return last - count + 1
