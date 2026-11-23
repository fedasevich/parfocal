import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import SimpleNamespace

from fastapi import BackgroundTasks
from pydantic import TypeAdapter
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.requests import Request

from parfocal_api.adjudications import AdjudicationDraft, ObjectRef, send_to_adjudicator
from parfocal_api.annotations import AnnotationDraft, Geometry, add, drawable_slide
from parfocal_api.decision_styles import DecisionSettings
from parfocal_api.disagreements import queue_of
from parfocal_api.principals import MemberPrincipal
from parfocal_api.realtime import NoRealtime
from parfocal_api.review_objects import list_review_objects
from parfocal_api.review_tasks import Scope, SlideSet, TaskDraft, create_review_task
from parfocal_api.reviewed_layer import EditDraft, save_review_edit
from parfocal_api.seed_request import seed_request
from parfocal_api.tables import (
    AnnotationKind,
    DecisionReason,
    DecisionStyle,
    DecisionValue,
    DrawingTool,
    ResultObjectKind,
    TaskKind,
    TaskScope,
    TaskSplit,
    adjudications,
    project_classes,
    result_objects,
    review_assignments,
    review_decisions,
    review_task_slides,
    review_tasks,
)
from parfocal_common.disagreements import Why
from parfocal_common.result_store import ResultStore

QUEUE_TASK = "Disagreement queue example"
DRAWN_TASK = "Drawn outline review example"
OUTLINE_SHIFT = 0.6
GEOMETRY = TypeAdapter[Geometry](Geometry)


@dataclass
class Seeded:
    tenant_id: uuid.UUID
    people: dict[str, uuid.UUID]
    owner: uuid.UUID | None = None


async def decide(
    connection: AsyncConnection,
    seeded: Seeded,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    key: str,
    value: DecisionValue,
    reasons: list[DecisionReason] | None = None,
    number: int = 1,
) -> None:
    await connection.execute(
        insert(review_decisions).values(
            tenant_id=seeded.tenant_id,
            project_id=project_id,
            task_id=task_id,
            slide_id=slide_id,
            user_id=seeded.people[key],
            kind="region",
            number=number,
            value=value,
            style=DecisionStyle.AGREE,
            answer=value,
            reasons=[reason.value for reason in reasons or []],
        )
    )


async def submit(connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID) -> None:
    await connection.execute(
        update(review_assignments)
        .where(review_assignments.c.task_id == task_id, review_assignments.c.slide_id == slide_id)
        .values(submitted_at=func.now())
    )


async def agree_and_submit(
    connection: AsyncConnection,
    seeded: Seeded,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> None:
    for key in ("rhea", "remy"):
        await decide(connection, seeded, project_id, task_id, slide_id, key, DecisionValue.AGREE)
    await submit(connection, task_id, slide_id)


async def review_task(
    connection: AsyncConnection,
    principal: MemberPrincipal,
    results: ResultStore,
    project_id: uuid.UUID,
    name: str,
    sets: Mapping[uuid.UUID, uuid.UUID | None],
    reviewers: list[uuid.UUID],
    style: DecisionStyle,
    kind: TaskKind = TaskKind.REVIEW,
    template_id: uuid.UUID | None = None,
    scope: Scope | None = None,
) -> uuid.UUID:
    reviewing = kind is TaskKind.REVIEW
    draft = TaskDraft(
        name=name,
        kind=kind,
        slide_ids=list(sets),
        result_sets=[
            SlideSet(slide_id=slide_id, result_set_id=set_id)
            for slide_id, set_id in sets.items()
            if set_id is not None
        ],
        reviewer_ids=reviewers,
        split=TaskSplit.EVERYONE,
        scope=(scope or Scope(kind=TaskScope.ALL_REGIONS)) if reviewing else None,
        blinded=False,
        decision=DecisionSettings(style=style) if reviewing else None,
    )
    if template_id is not None:
        draft = draft.model_copy(update={"study_template_id": template_id})
    task = await create_review_task(
        project_id,
        draft,
        principal,
        connection,
        results,
        NoRealtime(),
        BackgroundTasks(),
        seed_request(),
    )
    return task.id


def box(left: float, top: float, right: float, bottom: float) -> Geometry:
    ring = [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]]
    return GEOMETRY.validate_python({"type": "Polygon", "coordinates": [ring]})


async def redraw_apart(
    connection: AsyncConnection,
    reviewers: Sequence[MemberPrincipal],
    results: ResultStore,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> int | None:
    listed = await list_review_objects(task_id, slide_id, reviewers[0], connection, results)
    regions = [item for item in listed.objects if item.kind == "region" and item.outline]
    if len(regions) < 2:
        return None
    target = regions[1]
    ring: list[float] = target.outline or []
    xs, ys = ring[0::2], ring[1::2]
    left, top, right, bottom = min(xs), min(ys), max(xs), max(ys)
    shift = (right - left) * OUTLINE_SHIFT
    request = Request({"type": "http", "app": SimpleNamespace(results=results), "headers": []})
    for index, reviewer in enumerate(reviewers):
        moved = shift * index
        await save_review_edit(
            task_id,
            slide_id,
            target.object,
            EditDraft(geometry=box(left + moved, top, right + moved, bottom)),
            reviewer,
            connection,
            request,
        )
    return target.number


def left_for_agreement(
    numbers: Sequence[tuple[uuid.UUID, int]], decided: Mapping[uuid.UUID, set[int]]
) -> list[tuple[uuid.UUID, int]]:
    by_slide: dict[uuid.UUID, list[int]] = {}
    for slide_id, number in numbers:
        if number not in decided.get(slide_id, set()):
            by_slide.setdefault(slide_id, []).append(number)
    return [
        (slide_id, number)
        for slide_id, open_numbers in by_slide.items()
        for number in sorted(open_numbers)[:-1]
    ]


async def agree_on_the_rest(
    connection: AsyncConnection,
    seeded: Seeded,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    decided: Mapping[uuid.UUID, set[int]],
) -> None:
    numbers = await connection.execute(
        select(review_task_slides.c.slide_id, result_objects.c.number)
        .join(
            result_objects,
            (result_objects.c.result_set_id == review_task_slides.c.result_set_id)
            & (result_objects.c.kind == ResultObjectKind.REGION),
        )
        .where(review_task_slides.c.task_id == task_id)
    )
    rest = left_for_agreement([(row.slide_id, row.number) for row in numbers], decided)
    if not rest:
        return
    await connection.execute(
        insert(review_decisions),
        [
            {
                "tenant_id": seeded.tenant_id,
                "project_id": project_id,
                "task_id": task_id,
                "slide_id": slide_id,
                "user_id": seeded.people[key],
                "kind": "region",
                "number": number,
                "value": DecisionValue.AGREE,
                "style": DecisionStyle.AGREE,
                "answer": DecisionValue.AGREE,
                "reasons": [],
            }
            for slide_id, number in rest
            for key in ("rhea", "remy")
        ],
    )


async def seed_drawn_review(
    connection: AsyncConnection,
    seeded: Seeded,
    principal: MemberPrincipal,
    results: ResultStore,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> uuid.UUID:
    class_id = await connection.scalar(
        select(project_classes.c.id)
        .where(project_classes.c.project_id == project_id)
        .order_by(project_classes.c.key)
        .limit(1)
    )
    slide = await drawable_slide(connection, principal, slide_id)
    made = await add(
        connection,
        principal,
        slide,
        [
            AnnotationDraft(
                kind=AnnotationKind.REGION,
                geometry=box(400, 400, 1400, 1200),
                class_id=class_id,
                tool=DrawingTool.HAND,
            ),
            AnnotationDraft(
                kind=AnnotationKind.REGION,
                geometry=box(1800, 600, 2600, 1500),
                class_id=class_id,
                tool=DrawingTool.SMART_SELECT,
            ),
        ],
    )
    task = await create_review_task(
        project_id,
        TaskDraft(
            name=DRAWN_TASK,
            slide_ids=[slide_id],
            drawn_slide_ids=[slide_id],
            reviewer_ids=[seeded.people["rhea"], seeded.people["remy"]],
            split=TaskSplit.EVERYONE,
            scope=Scope(kind=TaskScope.ALL_REGIONS),
            blinded=False,
            decision=DecisionSettings(style=DecisionStyle.AGREE),
        ),
        principal,
        connection,
        results,
        NoRealtime(),
        BackgroundTasks(),
        seed_request(),
    )
    disputed, agreed = (ref.number for ref in made)
    await decide(
        connection,
        seeded,
        project_id,
        task.id,
        slide_id,
        "rhea",
        DecisionValue.AGREE,
        number=disputed,
    )
    await decide(
        connection,
        seeded,
        project_id,
        task.id,
        slide_id,
        "remy",
        DecisionValue.DISAGREE,
        [DecisionReason.BOUNDARY_OFF],
        number=disputed,
    )
    for key in ("rhea", "remy"):
        await decide(
            connection,
            seeded,
            project_id,
            task.id,
            slide_id,
            key,
            DecisionValue.AGREE,
            number=agreed,
        )
    await submit(connection, task.id, slide_id)
    return task.id


async def seed_adjudication(
    connection: AsyncConnection,
    creator: MemberPrincipal,
    adjudicator: uuid.UUID,
    name: str = QUEUE_TASK,
) -> None:
    task = (
        await connection.execute(
            select(review_tasks.c.id, review_tasks.c.project_id).where(
                review_tasks.c.tenant_id == creator.tenant_id,
                review_tasks.c.name == name,
            )
        )
    ).one_or_none()
    if task is None:
        return
    sent = await connection.scalar(
        select(adjudications.c.id).where(adjudications.c.task_id == task.id).limit(1)
    )
    if sent is not None:
        return
    queued = await queue_of(connection, task.id)
    first = next((item for item in queued if item.why is Why.OUTLINES_DIFFER), queued[0])
    await send_to_adjudicator(
        task.id,
        AdjudicationDraft(
            adjudicator_user_id=adjudicator,
            objects=[ObjectRef(slide_id=first.slide_id, object=first.object)],
        ),
        creator,
        connection,
        seed_request(),
        BackgroundTasks(),
    )
