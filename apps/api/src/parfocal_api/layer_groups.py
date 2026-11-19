import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import select, update

from parfocal_api.annotate_layer import editable_layer, readable_layer
from parfocal_api.annotations import drawable_slide, slide_row
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.tables import review_task_slides, slides

MAX_GROUPS = 500
MAX_MEMBERS = 20_000

type GroupName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
type Channel = Annotated[int, Field(ge=0, le=255)]


class LayerGroup(BaseModel):
    id: Annotated[int, Field(ge=1)]
    name: GroupName
    parent_id: int | None = None
    color: Annotated[list[Channel], Field(min_length=3, max_length=3)] | None = None
    hidden: bool = False
    locked: bool = False


class LayerMember(BaseModel):
    annotation_id: uuid.UUID
    group_id: Annotated[int, Field(ge=1)]


class LayerGroups(BaseModel):
    groups: Annotated[list[LayerGroup], Field(max_length=MAX_GROUPS)] = []
    members: Annotated[list[LayerMember], Field(max_length=MAX_MEMBERS)] = []

    @model_validator(mode="after")
    def is_consistent(self) -> LayerGroups:
        ids = [group.id for group in self.groups]
        if len(set(ids)) != len(ids):
            raise ValueError("Group ids are unique")
        known = set(ids)
        if any(
            group.parent_id is not None and group.parent_id not in known for group in self.groups
        ):
            raise ValueError("A group sits inside a group that exists")
        if any(member.group_id not in known for member in self.members):
            raise ValueError("A shape sits in a group that exists")
        return self


router = APIRouter(prefix="/api/slides/{slide_id}/layer-groups", tags=["annotations"])


@router.get("", operation_id="getLayerGroups", **require(Permission.SEE_SLIDES, emergency=True))
async def get_layer_groups(
    slide_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> LayerGroups:
    await slide_row(connection, principal, slide_id)
    stored = await connection.scalar(select(slides.c.layer_groups).where(slides.c.id == slide_id))
    return LayerGroups.model_validate(stored or {})


@router.put("", operation_id="setLayerGroups", **require(Permission.REVIEW, write=True))
async def set_layer_groups(
    slide_id: uuid.UUID,
    body: LayerGroups,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> LayerGroups:
    await drawable_slide(connection, principal, slide_id)
    await connection.execute(
        update(slides)
        .where(slides.c.id == slide_id)
        .values(layer_groups=body.model_dump(mode="json"))
    )
    return body


shared_router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/shared-layer/groups",
    tags=["review-tasks"],
)


def on_task_slide(task_id: uuid.UUID, slide_id: uuid.UUID) -> list[Any]:
    return [review_task_slides.c.task_id == task_id, review_task_slides.c.slide_id == slide_id]


@shared_router.get(
    "", operation_id="getSharedLayerGroups", **require(Permission.SEE_SLIDES, emergency=True)
)
async def get_shared_layer_groups(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> LayerGroups:
    await readable_layer(connection, principal, task_id, slide_id)
    stored = await connection.scalar(
        select(review_task_slides.c.layer_groups).where(*on_task_slide(task_id, slide_id))
    )
    return LayerGroups.model_validate(stored or {})


@shared_router.put(
    "", operation_id="setSharedLayerGroups", **require(Permission.REVIEW, write=True)
)
async def set_shared_layer_groups(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    body: LayerGroups,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    reason: Annotated[str | None, Query(max_length=500)] = None,
) -> LayerGroups:
    await editable_layer(connection, principal, task_id, slide_id, reason)
    await connection.execute(
        update(review_task_slides)
        .where(*on_task_slide(task_id, slide_id))
        .values(layer_groups=body.model_dump(mode="json"))
    )
    return body
