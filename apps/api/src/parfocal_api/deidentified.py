import base64
import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.identifiers import TenantKeys, blind
from parfocal_api.restricted_images import delete_restricted_images
from parfocal_api.tables import PrivacyMode, projects, slides
from parfocal_common.object_store import ObjectStore

PSEUDONYM_PREFIX = "Case "
PSEUDONYM_LENGTH = 10
PSEUDONYM_FIELD = "case-pseudonym"
NEUTRAL_LABEL = "Slide"


def keeps_restricted_images(mode: PrivacyMode) -> bool:
    return mode is PrivacyMode.CLINICAL


async def held_privacy(connection: AsyncConnection, project_id: uuid.UUID) -> PrivacyMode:
    found = await connection.scalar(
        select(projects.c.privacy_mode)
        .where(projects.c.id == project_id)
        .with_for_update(read=True)
    )
    return PrivacyMode.DE_IDENTIFIED if found is None else PrivacyMode(found)


def case_pseudonym(keys: TenantKeys, project_id: uuid.UUID, source_case_id: uuid.UUID) -> str:
    digest = blind(keys, PSEUDONYM_FIELD, f"{project_id}:{source_case_id}")
    code = base64.b32encode(digest).decode().rstrip("=")[:PSEUDONYM_LENGTH]
    return f"{PSEUDONYM_PREFIX}{code}"


async def strip_restricted_images(
    connection: AsyncConnection, store: ObjectStore, tenant_id: uuid.UUID, project_id: uuid.UUID
) -> int:
    labelled = await connection.scalars(
        update(slides)
        .where(slides.c.project_id == project_id, func.cardinality(slides.c.restricted_images) > 0)
        .values(restricted_images=[])
        .returning(slides.c.id)
    )
    deleted = 0
    for slide_id in labelled.all():
        deleted += await delete_restricted_images(store, tenant_id, slide_id)
    return deleted


def numbered(index: int) -> str:
    return NEUTRAL_LABEL if index == 0 else f"{NEUTRAL_LABEL} ({index + 1})"


async def neutral_labels(connection: AsyncConnection, project_id: uuid.UUID) -> int:
    rows = (
        await connection.execute(
            select(slides.c.id, slides.c.case_id, slides.c.label, slides.c.deleted_at)
            .where(slides.c.project_id == project_id)
            .order_by(slides.c.case_id, slides.c.published_at, slides.c.id)
            .with_for_update()
        )
    ).all()
    wanted: dict[uuid.UUID, str] = {}
    places: dict[uuid.UUID | None, int] = {}
    for row in rows:
        if row.deleted_at is not None:
            wanted[row.id] = NEUTRAL_LABEL
            continue
        index = places.get(row.case_id, 0)
        places[row.case_id] = index + 1
        wanted[row.id] = numbered(index)
    changed = [row for row in rows if wanted[row.id] != row.label]
    for row in changed:
        await connection.execute(
            update(slides).where(slides.c.id == row.id).values(label=str(row.id))
        )
    for row in changed:
        await connection.execute(
            update(slides).where(slides.c.id == row.id).values(label=wanted[row.id])
        )
    return len(changed)
