import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.object_ids import Letter

NEXT_NUMBERS = text(
    "INSERT INTO slide_counters (tenant_id, slide_id, letter, last) "
    "VALUES (:tenant_id, :slide_id, :letter, CAST(:above AS integer) + CAST(:count AS integer)) "
    "ON CONFLICT (slide_id, letter) "
    "DO UPDATE SET last = GREATEST(slide_counters.last, CAST(:above AS integer)) "
    "+ CAST(:count AS integer) "
    "RETURNING last"
)
COVERED = text(
    "INSERT INTO slide_counters (tenant_id, slide_id, letter, last) "
    "VALUES (:tenant_id, :slide_id, :letter, :last) "
    "ON CONFLICT (slide_id, letter) "
    "DO UPDATE SET last = GREATEST(slide_counters.last, EXCLUDED.last)"
)


async def reserve(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    slide_id: uuid.UUID,
    letter: Letter,
    count: int,
    above: int = 0,
) -> int:
    if count < 1:
        raise ValueError("Reserve at least one number")
    last = await connection.scalar(
        NEXT_NUMBERS,
        {
            "tenant_id": tenant_id,
            "slide_id": slide_id,
            "letter": letter.value,
            "count": count,
            "above": above,
        },
    )
    assert isinstance(last, int)
    return last - count + 1


async def cover(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    slide_id: uuid.UUID,
    letter: Letter,
    last: int,
) -> None:
    if last < 1:
        return
    await connection.execute(
        COVERED,
        {"tenant_id": tenant_id, "slide_id": slide_id, "letter": letter.value, "last": last},
    )
