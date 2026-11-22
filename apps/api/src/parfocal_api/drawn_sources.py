import uuid
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, Integer, bindparam, func, insert, literal, select, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.types import Uuid

from parfocal_api.audit import Actor, AuditAction, AuditTarget, actor_of, record
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.review_task_errors import NoResultSetError
from parfocal_api.tables import (
    AnnotationKind,
    ResultObjectKind,
    ResultSource,
    ResultStatus,
    annotations,
    project_classes,
    result_objects,
    result_set_classes,
    result_sets,
    review_task_slides,
)

DRAWN_NAME = "Drawn objects"


@dataclass(frozen=True)
class Drawer:
    user_id: uuid.UUID | None
    tool: str | None


def drawn_on(slide_ids: Collection[uuid.UUID]) -> list[ColumnElement[bool]]:
    return [
        annotations.c.slide_id.in_(slide_ids),
        annotations.c.task_id.is_(None),
        annotations.c.deleted_at.is_(None),
        annotations.c.kind == AnnotationKind.REGION,
    ]


def not_drawn() -> ColumnElement[bool]:
    return result_sets.c.source != ResultSource.DRAWN


async def drawn_counts(
    connection: AsyncConnection, slide_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, int]:
    if not slide_ids:
        return {}
    rows = await connection.execute(
        select(annotations.c.slide_id, func.count())
        .where(*drawn_on(slide_ids))
        .group_by(annotations.c.slide_id)
    )
    return {slide_id: int(count) for slide_id, count in rows}


async def snapshot_drawn(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    actor: Actor,
    user_id: uuid.UUID | None,
) -> uuid.UUID | None:
    counts = await connection.execute(
        select(annotations.c.class_id, func.count())
        .where(*drawn_on([slide_id]))
        .group_by(annotations.c.class_id)
    )
    per_class = {class_id: int(count) for class_id, count in counts}
    if not per_class:
        return None
    named = await connection.execute(
        select(project_classes.c.id, project_classes.c.name)
        .where(project_classes.c.id.in_([key for key in per_class if key is not None]))
        .order_by(project_classes.c.name)
    )
    classes = [(row.id, row.name) for row in named]
    set_id = await connection.scalar(
        insert(result_sets)
        .values(
            tenant_id=tenant_id,
            project_id=project_id,
            slide_id=slide_id,
            name=DRAWN_NAME,
            source=ResultSource.DRAWN,
            created_by_user_id=user_id,
        )
        .returning(result_sets.c.id)
    )
    assert isinstance(set_id, uuid.UUID)
    if classes:
        await connection.execute(
            insert(result_set_classes),
            [
                {
                    "tenant_id": tenant_id,
                    "project_id": project_id,
                    "result_set_id": set_id,
                    "position": position,
                    "source_name": name,
                    "class_id": class_id,
                    "object_count": per_class[class_id],
                }
                for position, (class_id, name) in enumerate(classes)
            ],
        )
    positions = bindparam("positions", [class_id for class_id, _ in classes], ARRAY(Uuid()))
    await connection.execute(
        insert(result_objects).from_select(
            [
                "tenant_id",
                "result_set_id",
                "kind",
                "number",
                "geometry",
                "class_index",
                "drawn_by_user_id",
                "tool",
            ],
            select(
                annotations.c.tenant_id,
                literal(set_id, Uuid()),
                literal(ResultObjectKind.REGION.value),
                annotations.c.number,
                annotations.c.geometry,
                (func.array_position(positions, annotations.c.class_id) - 1).cast(Integer),
                annotations.c.created_by_user_id,
                annotations.c.tool,
            ).where(*drawn_on([slide_id])),
        )
    )
    await connection.execute(
        update(result_sets)
        .where(result_sets.c.id == set_id)
        .values(status=ResultStatus.READY, region_count=sum(per_class.values()))
    )
    await record(
        connection,
        actor,
        AuditAction.RESULT_SET_CREATED,
        AuditTarget.RESULT_SET,
        set_id,
        tenant_id=tenant_id,
        details={
            "slide_id": str(slide_id),
            "source": ResultSource.DRAWN.value,
            "classes": len(classes),
            "objects": sum(per_class.values()),
        },
    )
    return set_id


async def drawn_sets(
    connection: AsyncConnection,
    project: Any,
    slide_ids: Sequence[uuid.UUID],
    wanted: Collection[uuid.UUID],
    principal: Principal,
) -> dict[uuid.UUID, uuid.UUID]:
    picked: dict[uuid.UUID, uuid.UUID] = {}
    for slide_id in slide_ids:
        if slide_id not in wanted:
            continue
        set_id = await snapshot_drawn(
            connection,
            project.tenant_id,
            project.id,
            slide_id,
            actor_of(principal),
            principal.user_id if isinstance(principal, MemberPrincipal) else None,
        )
        if set_id is not None:
            picked[slide_id] = set_id
    if set(wanted) - set(picked):
        raise NoResultSetError("Pick drawn objects only on a task slide that has drawn outlines")
    return picked


async def drawn_task_slides(
    connection: AsyncConnection, task_ids: Iterable[uuid.UUID]
) -> set[tuple[uuid.UUID, uuid.UUID]]:
    wanted = list(task_ids)
    if not wanted:
        return set()
    rows = await connection.execute(
        select(review_task_slides.c.task_id, review_task_slides.c.slide_id)
        .join(result_sets, result_sets.c.id == review_task_slides.c.result_set_id)
        .where(
            review_task_slides.c.task_id.in_(wanted),
            result_sets.c.source == ResultSource.DRAWN,
        )
    )
    return {(row.task_id, row.slide_id) for row in rows}


async def reviews_ai(connection: AsyncConnection, task_id: uuid.UUID) -> bool:
    found = await connection.scalar(
        select(func.count())
        .select_from(review_task_slides)
        .join(result_sets, result_sets.c.id == review_task_slides.c.result_set_id)
        .where(
            review_task_slides.c.task_id == task_id,
            result_sets.c.source != ResultSource.DRAWN,
        )
    )
    return bool(found)


async def drawers_of(connection: AsyncConnection, set_id: uuid.UUID | None) -> dict[int, Drawer]:
    if set_id is None:
        return {}
    rows = await connection.execute(
        select(result_objects.c.number, result_objects.c.drawn_by_user_id, result_objects.c.tool)
        .join(result_sets, result_sets.c.id == result_objects.c.result_set_id)
        .where(
            result_objects.c.result_set_id == set_id,
            result_objects.c.kind == ResultObjectKind.REGION,
            result_sets.c.source == ResultSource.DRAWN,
        )
    )
    return {row.number: Drawer(row.drawn_by_user_id, row.tool) for row in rows}
