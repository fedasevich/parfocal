import uuid
from collections.abc import Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import slides

KEY = "compare_alignments"


def slides_of(pair: str) -> tuple[uuid.UUID, uuid.UUID]:
    left, right = pair.split(":")
    return uuid.UUID(left), uuid.UUID(right)


async def fingerprints(
    connection: AsyncConnection, pairs: Mapping[str, Any]
) -> dict[uuid.UUID, str]:
    wanted = {slide for pair in pairs for slide in slides_of(pair)}
    if not wanted:
        return {}
    rows = await connection.execute(
        select(slides.c.id, slides.c.sha256, slides.c.upload_id).where(
            slides.c.id.in_(wanted), slides.c.deleted_at.is_(None)
        )
    )
    return {row.id: f"{row.upload_id}:{row.sha256}" for row in rows}


def current_of(pair: str, known: Mapping[uuid.UUID, str]) -> str | None:
    left, right = slides_of(pair)
    if left not in known or right not in known:
        return None
    return f"{known[left]}|{known[right]}"


async def kept(connection: AsyncConnection, pairs: Mapping[str, Any]) -> dict[str, Any]:
    known = await fingerprints(connection, pairs)
    result: dict[str, Any] = {}
    for pair, offset in pairs.items():
        current = current_of(pair, known)
        if current is None:
            continue
        stamp = offset.get("fingerprint")
        if stamp is None:
            result[pair] = {**offset, "fingerprint": current}
        elif stamp == current:
            result[pair] = offset
    return result


async def pruned(connection: AsyncConnection, personal: Mapping[str, Any]) -> dict[str, Any]:
    pairs = personal.get(KEY)
    if not pairs:
        return dict(personal)
    survivors = await kept(connection, pairs)
    others = {key: value for key, value in personal.items() if key != KEY}
    return {**others, KEY: survivors} if survivors else others
