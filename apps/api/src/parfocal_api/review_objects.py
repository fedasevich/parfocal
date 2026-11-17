import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotate_layer import TOP_SCORE, stored_cells
from parfocal_api.annotations import code_of as added_code
from parfocal_api.blinding import ai_hidden_on, sees_reviewer, user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.display import reviewed_task, usable_on
from parfocal_api.display_settings import FIELD_OF, display_of
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.review_order import Results, order_state, temperature_of
from parfocal_api.review_tasks import code_of
from parfocal_api.reviewed_layer import review_slide, task_slide
from parfocal_api.tables import (
    AnnotationKind,
    annotations,
    cases,
    display_presets,
    project_classes,
    result_chunks,
    result_objects,
    result_set_classes,
    review_assignments,
    review_decisions,
    review_order,
    slides,
)
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.result_store import ResultStore
from parfocal_common.review_order import UNCALIBRATED, certainty_of, unpack

type ObjectKey = tuple[Letter, int]
type SettingValue = str | float | bool


class SlideFacts(BaseModel):
    label: str
    case_label: str | None
    stain: str
    width: int | None
    height: int | None


class ReviewObject(BaseModel):
    object: str
    kind: Literal["region", "cell"]
    number: int
    class_name: str
    score: float = Field(ge=0, le=1)
    size_mm: float | None
    other_class: str | None
    detector_score: float | None = None
    foreground: float | None = None
    outline: list[float] | None = None


class AddedObject(BaseModel):
    object: str
    note: str | None


class ReviewObjects(BaseModel):
    task_id: uuid.UUID
    slide_id: uuid.UUID
    slide: SlideFacts
    objects: list[ReviewObject]
    added: list[AddedObject]


class SlideAgreement(BaseModel):
    task_id: uuid.UUID
    slide_id: uuid.UUID
    with_user_id: uuid.UUID | None
    agree: int
    total: int


class DisplayLock(BaseModel):
    setting: str
    value: SettingValue
    reason: str


class TaskPreset(BaseModel):
    name: str
    key: str
    settings: dict[str, SettingValue]


class TaskDisplay(BaseModel):
    task_id: uuid.UUID
    task_code: str
    locks: list[DisplayLock]
    presets: list[TaskPreset]


@dataclass(frozen=True)
class AiClaim:
    class_name: str
    score: float
    size_mm: float | None = None
    other_class: str | None = None
    outline: list[float] | None = None


UNKNOWN = AiClaim(class_name="", score=0.0)
FIRST_PRESET_KEY = 2

router = APIRouter(prefix="/api/review-tasks/{task_id}", tags=["review-tasks"])


def share(value: int | None) -> float:
    return 0.0 if value is None else min(max(value / TOP_SCORE, 0.0), 1.0)


def runner_up(probabilities: Sequence[int] | None, top: int | None) -> int | None:
    if not probabilities or len(probabilities) < 2:
        return None
    ranked = sorted(
        (position for position in range(len(probabilities)) if position != top),
        key=lambda position: -probabilities[position],
    )
    return ranked[0] if ranked else None


async def class_names(connection: AsyncConnection, set_id: uuid.UUID) -> dict[int, str]:
    rows = await connection.execute(
        select(
            result_set_classes.c.position,
            func.coalesce(project_classes.c.name, result_set_classes.c.source_name).label("name"),
        )
        .select_from(result_set_classes)
        .outerjoin(project_classes, project_classes.c.id == result_set_classes.c.class_id)
        .where(result_set_classes.c.result_set_id == set_id)
    )
    return {row.position: row.name for row in rows}


async def millimetres_per_pixel(connection: AsyncConnection, slide_id: uuid.UUID) -> float | None:
    mpp = await connection.scalar(select(slides.c.mpp_x).where(slides.c.id == slide_id))
    return None if mpp is None else float(mpp) / 1000


async def region_claims(
    connection: AsyncConnection,
    set_id: uuid.UUID,
    numbers: Iterable[int],
    names: Mapping[int, str],
    mm: float | None,
    temperature: float,
) -> dict[ObjectKey, AiClaim]:
    wanted = sorted(set(numbers))
    if not wanted:
        return {}
    rows = await connection.execute(
        select(
            result_objects.c.number,
            result_objects.c.class_index,
            result_objects.c.score,
            result_objects.c.probabilities,
            func.greatest(
                func.ST_XMax(result_objects.c.geometry) - func.ST_XMin(result_objects.c.geometry),
                func.ST_YMax(result_objects.c.geometry) - func.ST_YMin(result_objects.c.geometry),
            ).label("across"),
        ).where(
            result_objects.c.result_set_id == set_id,
            result_objects.c.kind == "region",
            result_objects.c.number.in_(wanted),
        )
    )
    claims: dict[ObjectKey, AiClaim] = {}
    for row in rows:
        other = runner_up(row.probabilities, row.class_index)
        claims[(Letter.REGION, row.number)] = AiClaim(
            class_name=names.get(row.class_index, "") if row.class_index is not None else "",
            score=share(certainty_of(row.class_index, row.score, row.probabilities, temperature)),
            size_mm=None if mm is None else round(float(row.across) * mm, 3),
            other_class=None if other is None else names.get(other),
        )
    return claims


async def cell_claims(
    connection: AsyncConnection,
    store: ResultStore,
    set_id: uuid.UUID,
    numbers: Iterable[int],
    names: Mapping[int, str],
    temperature: float,
) -> dict[ObjectKey, AiClaim]:
    wanted = set(numbers)
    if not wanted:
        return {}
    keys = await connection.scalars(
        select(result_chunks.c.object_key)
        .where(result_chunks.c.result_set_id == set_id)
        .order_by(result_chunks.c.chunk)
    )
    claims: dict[ObjectKey, AiClaim] = {}
    for object_key in keys.all():
        for cell in await stored_cells(store, object_key):
            if cell.number not in wanted:
                continue
            other = cell.alt_class
            if other is None:
                other = runner_up(cell.probs, cell.class_index)
            claims[(Letter.CELL, cell.number)] = AiClaim(
                class_name=names.get(cell.class_index, ""),
                score=share(certainty_of(cell.class_index, cell.score, cell.probs, temperature)),
                other_class=None if other is None else names.get(other),
                outline=list(cell.ring) if len(cell.ring) >= 6 else None,
            )
        if len(claims) == len(wanted):
            break
    return claims


async def ai_claims(
    connection: AsyncConnection,
    store: ResultStore,
    set_id: uuid.UUID | None,
    slide_id: uuid.UUID,
    keys: Iterable[ObjectKey],
) -> dict[ObjectKey, AiClaim]:
    if set_id is None:
        return {}
    listed = list(keys)
    names = await class_names(connection, set_id)
    temperature = await temperature_of(connection, set_id) if listed else UNCALIBRATED
    regions = await region_claims(
        connection,
        set_id,
        (number for letter, number in listed if letter is Letter.REGION),
        names,
        await millimetres_per_pixel(connection, slide_id),
        temperature,
    )
    cells = await cell_claims(
        connection,
        store,
        set_id,
        (number for letter, number in listed if letter is Letter.CELL),
        names,
        temperature,
    )
    return regions | cells


async def slide_facts(connection: AsyncConnection, slide_id: uuid.UUID) -> SlideFacts:
    row = (
        await connection.execute(
            select(
                slides.c.label,
                slides.c.stain,
                slides.c.width,
                slides.c.height,
                cases.c.label.label("case_label"),
            )
            .select_from(slides)
            .outerjoin(cases, cases.c.id == slides.c.case_id)
            .where(slides.c.id == slide_id)
        )
    ).one()
    return SlideFacts(
        label=row.label,
        case_label=row.case_label,
        stain=row.stain,
        width=row.width if row.width and row.width > 0 else None,
        height=row.height if row.height and row.height > 0 else None,
    )


async def ordered_keys(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID
) -> list[ObjectKey]:
    packed = await connection.scalar(
        select(review_order.c.objects).where(
            review_order.c.task_id == task_id, review_order.c.slide_id == slide_id
        )
    )
    if packed is None:
        await order_state(connection, task_id)
        return []
    return unpack(bytes(packed))


def kind_of(letter: Letter) -> Literal["region", "cell"]:
    return "region" if letter is Letter.REGION else "cell"


async def added_objects(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID, slide_id: uuid.UUID
) -> list[AddedObject]:
    me = user_of(principal)
    if me is None:
        return []
    rows = await connection.execute(
        select(annotations.c.kind, annotations.c.number, annotations.c.text)
        .where(
            annotations.c.task_id == task_id,
            annotations.c.slide_id == slide_id,
            annotations.c.created_by_user_id == me,
            annotations.c.deleted_at.is_(None),
            annotations.c.kind.in_([AnnotationKind.REGION, AnnotationKind.CELL]),
        )
        .order_by(annotations.c.kind, annotations.c.number)
    )
    return [
        AddedObject(object=added_code(AnnotationKind(row.kind), row.number), note=row.text or None)
        for row in rows
    ]


@router.get(
    "/slides/{slide_id}/objects",
    operation_id="listReviewObjects",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_review_objects(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> ReviewObjects:
    row = await task_slide(connection, principal, task_id, slide_id)
    facts = await slide_facts(connection, slide_id)
    added = await added_objects(connection, principal, task_id, slide_id)
    if await ai_hidden_on(connection, principal, row.project_id, slide_id):
        return ReviewObjects(
            task_id=task_id, slide_id=slide_id, slide=facts, objects=[], added=added
        )
    keys = await ordered_keys(connection, task_id, slide_id)
    claims = await ai_claims(connection, results, row.result_set_id, slide_id, keys)
    objects: list[ReviewObject] = []
    for letter, number in keys:
        claim = claims.get((letter, number), UNKNOWN)
        objects.append(
            ReviewObject(
                object=ObjectId(letter, number).text(ascii=True),
                kind=kind_of(letter),
                number=number,
                class_name=claim.class_name,
                score=claim.score,
                size_mm=claim.size_mm,
                other_class=claim.other_class,
                outline=claim.outline,
            )
        )
    return ReviewObjects(
        task_id=task_id, slide_id=slide_id, slide=facts, objects=objects, added=added
    )


async def submitted_reviewers(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID
) -> list[uuid.UUID]:
    rows = await connection.scalars(
        select(review_assignments.c.user_id)
        .where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.slide_id == slide_id,
            review_assignments.c.released_at.is_(None),
            review_assignments.c.submitted_at.is_not(None),
        )
        .order_by(review_assignments.c.assigned_at, review_assignments.c.user_id)
    )
    return list(rows.all())


async def values_of(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, user_id: uuid.UUID
) -> dict[tuple[str, int], str]:
    rows = await connection.execute(
        select(review_decisions.c.kind, review_decisions.c.number, review_decisions.c.value).where(
            review_decisions.c.task_id == task_id,
            review_decisions.c.slide_id == slide_id,
            review_decisions.c.user_id == user_id,
        )
    )
    return {(row.kind, row.number): row.value for row in rows}


@router.get(
    "/slides/{slide_id}/agreement",
    operation_id="getSlideAgreement",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_slide_agreement(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> SlideAgreement:
    row = await review_slide(connection, principal, task_id, slide_id)
    nothing = SlideAgreement(
        task_id=task_id, slide_id=slide_id, with_user_id=None, agree=0, total=0
    )
    me = user_of(principal)
    submitted = await submitted_reviewers(connection, task_id, slide_id)
    if me is None or me not in submitted:
        return nothing
    mine = await values_of(connection, task_id, slide_id, me)
    for other in submitted:
        if other == me or not await sees_reviewer(
            connection, principal, row.project_id, task_id, slide_id, other
        ):
            continue
        theirs = await values_of(connection, task_id, slide_id, other)
        both = mine.keys() & theirs.keys()
        return SlideAgreement(
            task_id=task_id,
            slide_id=slide_id,
            with_user_id=other,
            agree=sum(mine[key] == theirs[key] for key in both),
            total=len(both),
        )
    return nothing


def scalar_settings(settings: Mapping[str, Any]) -> dict[str, SettingValue]:
    return {
        key: value for key, value in settings.items() if isinstance(value, str | int | float | bool)
    }


@router.get("/display", operation_id="getTaskDisplay", **require(Permission.REVIEW))
async def get_task_display(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> TaskDisplay:
    task = await reviewed_task(connection, principal, task_id)
    display = display_of(task.display)
    defaults = display.defaults.model_dump(mode="json")
    locks = [
        DisplayLock(setting=str(lock), value=value, reason=reason)
        for lock, reason in sorted(display.locks.items())
        if isinstance(value := defaults[FIELD_OF[lock]], str | int | float | bool)
    ]
    me = user_of(principal)
    presets = (
        []
        if me is None
        else [
            TaskPreset(
                name=preset.name,
                key=f"⇧{index + FIRST_PRESET_KEY}",
                settings=scalar_settings(preset.settings),
            )
            for index, preset in enumerate(
                await connection.execute(
                    select(display_presets.c.name, display_presets.c.settings)
                    .where(*usable_on(me, task_id))
                    .order_by(display_presets.c.created_at)
                )
            )
        ]
    )
    return TaskDisplay(
        task_id=task_id, task_code=code_of(task.number), locks=locks, presets=presets
    )
