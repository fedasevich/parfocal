import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from fastapi import BackgroundTasks
from pydantic import TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotate_layer import (
    AiObjectConfirm,
    AiObjectEdit,
    LayerObject,
    SharedAiObject,
    change_ai_object,
    change_shared_object,
    confirm_ai_object,
    create_shared_object,
    delete_shared_object,
    list_shared_ai_objects,
)
from parfocal_api.annotations import AnnotationDraft, AnnotationEdit, Geometry
from parfocal_api.evaluation import class_names
from parfocal_api.layer_groups import LayerGroup, LayerGroups, LayerMember, set_shared_layer_groups
from parfocal_api.principals import MemberPrincipal
from parfocal_api.realtime import NoRealtime
from parfocal_api.review_tasks import SlideSet, TaskDraft, create_review_task
from parfocal_api.seed_request import seed_request
from parfocal_api.tables import (
    AnnotationKind,
    ResultStatus,
    TaskKind,
    TaskSplit,
    projects,
    result_sets,
    review_tasks,
    slides,
)
from parfocal_common.result_store import ResultStore

EXAMPLE_TASK = "Annotation example"
EXAMPLE_SLIDE = "Philips-3.tiff"
OUTLINES_GROUP = "Tumour outlines"
CELLS_GROUP = "Typed cells"
EXAMPLE_NOTE = "Check this border with a second expert"
AI_CELLS_USED = 5
FALLBACK_ANCHOR = (45000.0, 14000.0)
REGION_SIDE = 300.0
CELL_SIDE = 14.0
GEOMETRY = TypeAdapter[Geometry](Geometry)


@dataclass
class Drawn:
    outlines: list[uuid.UUID] = field(default_factory=list[uuid.UUID])
    cells: list[uuid.UUID] = field(default_factory=list[uuid.UUID])


def square(x: float, y: float, side: float) -> Geometry:
    ring = [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]
    return GEOMETRY.validate_python({"type": "Polygon", "coordinates": [ring]})


def shape(value: dict[str, Any]) -> Geometry:
    return GEOMETRY.validate_python(value)


def shrunk(found: SharedAiObject) -> Geometry:
    ring = found.geometry.model_dump()["coordinates"][0]
    xs = sum(point[0] for point in ring[:-1]) / (len(ring) - 1)
    ys = sum(point[1] for point in ring[:-1]) / (len(ring) - 1)
    inner = [[xs + (x - xs) * 0.8, ys + (y - ys) * 0.8] for x, y in ring]
    return shape({"type": "Polygon", "coordinates": [inner]})


@dataclass(frozen=True)
class Layer:
    connection: AsyncConnection
    principal: MemberPrincipal
    results: ResultStore
    task_id: uuid.UUID
    slide_id: uuid.UUID

    async def draw(self, draft: AnnotationDraft) -> LayerObject:
        return await create_shared_object(
            self.task_id,
            self.slide_id,
            draft,
            self.principal,
            self.connection,
            BackgroundTasks(),
            NoRealtime(),
        )

    async def edit(self, made: LayerObject, edit: dict[str, Any]) -> LayerObject:
        return await change_shared_object(
            self.task_id,
            self.slide_id,
            made.id,
            AnnotationEdit.model_validate({"version": made.version, **edit}),
            self.principal,
            self.connection,
            BackgroundTasks(),
            NoRealtime(),
        )

    async def delete(self, made: LayerObject) -> None:
        await delete_shared_object(
            self.task_id,
            self.slide_id,
            made.id,
            made.version,
            self.principal,
            self.connection,
            BackgroundTasks(),
            NoRealtime(),
        )

    async def ai_cells(self) -> list[SharedAiObject]:
        listed = await list_shared_ai_objects(
            self.task_id, self.slide_id, self.principal, self.connection, self.results, 0, 50
        )
        return [found for found in listed.objects if found.kind == "cell"][:AI_CELLS_USED]

    async def confirm(self, found: SharedAiObject) -> LayerObject:
        return await confirm_ai_object(
            self.task_id,
            self.slide_id,
            found.object,
            AiObjectConfirm(geometry=shape(found.geometry.model_dump())),
            self.principal,
            self.connection,
            BackgroundTasks(),
            NoRealtime(),
            self.results,
        )

    async def change_ai(self, found: SharedAiObject, edit: AiObjectEdit) -> LayerObject:
        return await change_ai_object(
            self.task_id,
            self.slide_id,
            found.object,
            edit,
            self.principal,
            self.connection,
            BackgroundTasks(),
            NoRealtime(),
            self.results,
        )


async def example_task(connection: AsyncConnection, project_id: uuid.UUID) -> uuid.UUID | None:
    return await connection.scalar(
        select(review_tasks.c.id).where(
            review_tasks.c.project_id == project_id, review_tasks.c.name == EXAMPLE_TASK
        )
    )


async def cell_set(connection: AsyncConnection, slide_id: uuid.UUID) -> uuid.UUID | None:
    return await connection.scalar(
        select(result_sets.c.id)
        .where(
            result_sets.c.slide_id == slide_id,
            result_sets.c.status == ResultStatus.READY,
            result_sets.c.cell_count > 0,
        )
        .order_by(result_sets.c.created_at.desc())
        .limit(1)
    )


async def draw_shapes(layer: Layer, classes: Sequence[uuid.UUID], x: float, y: float) -> Drawn:
    drawn = Drawn()
    for index, class_id in enumerate(classes):
        region = await layer.draw(
            AnnotationDraft(
                kind=AnnotationKind.REGION,
                geometry=square(x + index * 2 * REGION_SIDE, y - 4 * REGION_SIDE, REGION_SIDE),
                class_id=class_id,
            )
        )
        drawn.outlines.append(region.id)
        for row in range(2):
            cell = await layer.draw(
                AnnotationDraft(
                    kind=AnnotationKind.CELL,
                    geometry=square(
                        x + index * 4 * CELL_SIDE,
                        y + 40 * CELL_SIDE + row * 3 * CELL_SIDE,
                        CELL_SIDE,
                    ),
                    class_id=class_id,
                )
            )
            drawn.cells.append(cell.id)
    first = await layer.draw(
        AnnotationDraft(
            kind=AnnotationKind.REGION, geometry=square(x, y - 8 * REGION_SIDE, REGION_SIDE)
        )
    )
    reshaped = await layer.edit(
        first, {"geometry": square(x, y - 8 * REGION_SIDE, 2 * REGION_SIDE)}
    )
    retyped = await layer.edit(reshaped, {"class_id": classes[0]})
    drawn.outlines.append(retyped.id)
    mistake = await layer.draw(
        AnnotationDraft(
            kind=AnnotationKind.REGION,
            geometry=square(x + 3 * REGION_SIDE, y - 8 * REGION_SIDE, 50),
        )
    )
    await layer.delete(mistake)
    line = [[x, y - 2 * REGION_SIDE], [x + 2 * REGION_SIDE, y - 2 * REGION_SIDE]]
    await layer.draw(
        AnnotationDraft(
            kind=AnnotationKind.MEASUREMENT,
            geometry=shape({"type": "LineString", "coordinates": line}),
        )
    )
    await layer.draw(
        AnnotationDraft(
            kind=AnnotationKind.TEXT,
            geometry=shape({"type": "Point", "coordinates": [x, y - 5 * REGION_SIDE]}),
            text=EXAMPLE_NOTE,
        )
    )
    return drawn


async def work_ai_cells(layer: Layer, classes: Sequence[uuid.UUID], drawn: Drawn) -> None:
    found = await layer.ai_cells()
    if len(found) < AI_CELLS_USED:
        return
    kept, retyped, reshaped, removed, confirmed_then_edited = found

    def other_than(current: uuid.UUID | None) -> uuid.UUID:
        return next(class_id for class_id in classes if class_id != current)

    copies = [
        await layer.confirm(kept),
        await layer.change_ai(
            retyped,
            AiObjectEdit(
                geometry=shape(retyped.geometry.model_dump()),
                class_id=other_than(retyped.class_id),
            ),
        ),
        await layer.change_ai(
            reshaped, AiObjectEdit(geometry=shrunk(reshaped), class_id=reshaped.class_id)
        ),
    ]
    await layer.change_ai(
        removed, AiObjectEdit(geometry=shape(removed.geometry.model_dump()), deleted=True)
    )
    confirmed = await layer.confirm(confirmed_then_edited)
    copies.append(
        await layer.edit(confirmed, {"class_id": other_than(confirmed_then_edited.class_id)})
    )
    drawn.cells.extend(copy.id for copy in copies)


async def save_groups(layer: Layer, drawn: Drawn) -> None:
    body = LayerGroups(
        groups=[
            LayerGroup(id=1, name=OUTLINES_GROUP, color=[230, 120, 40]),
            LayerGroup(id=2, name=CELLS_GROUP, color=[60, 140, 220]),
        ],
        members=[
            *(LayerMember(annotation_id=item, group_id=1) for item in drawn.outlines),
            *(LayerMember(annotation_id=item, group_id=2) for item in drawn.cells),
        ],
    )
    await set_shared_layer_groups(
        layer.task_id, layer.slide_id, body, layer.principal, layer.connection
    )


async def first_cell_at(layer: Layer) -> tuple[float, float]:
    found = await layer.ai_cells()
    if not found:
        return FALLBACK_ANCHOR
    x, y = found[0].geometry.model_dump()["coordinates"][0][0]
    return float(x) + 600, float(y) + 600


async def seed_annotation_example(
    connection: AsyncConnection,
    creator: MemberPrincipal,
    owner: MemberPrincipal,
    results: ResultStore,
    gallery: str,
    experts: Sequence[uuid.UUID],
) -> uuid.UUID | None:
    project_id = await connection.scalar(
        select(projects.c.id).where(
            projects.c.tenant_id == creator.tenant_id, projects.c.name == gallery
        )
    )
    if project_id is None or await example_task(connection, project_id) is not None:
        return None
    slide_id = await connection.scalar(
        select(slides.c.id)
        .where(slides.c.project_id == project_id, slides.c.label == EXAMPLE_SLIDE)
        .order_by(func.coalesce(slides.c.width, 0).desc())
        .limit(1)
    )
    if slide_id is None:
        return None
    set_id = await cell_set(connection, slide_id)
    task = await create_review_task(
        project_id,
        TaskDraft(
            name=EXAMPLE_TASK,
            kind=TaskKind.ANNOTATE,
            slide_ids=[slide_id],
            result_sets=[]
            if set_id is None
            else [SlideSet(slide_id=slide_id, result_set_id=set_id)],
            reviewer_ids=list(dict.fromkeys(experts)),
            split=TaskSplit.EVERYONE,
            blinded=False,
        ),
        creator,
        connection,
        results,
        NoRealtime(),
        BackgroundTasks(),
        seed_request(),
    )
    names = await class_names(connection, project_id)
    classes = sorted(names, key=lambda class_id: names[class_id])
    layer = Layer(connection, owner, results, task.id, slide_id)
    x, y = await first_cell_at(layer)
    drawn = await draw_shapes(layer, classes, x, y)
    await work_ai_cells(layer, classes, drawn)
    await save_groups(layer, drawn)
    return task.id
