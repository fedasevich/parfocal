import uuid
from collections.abc import Mapping
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.annotations import code_of as added_code
from parfocal_api.blinding import ai_hidden_on, sees_reviewer, user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.evaluation import AREAS
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.review_objects import submitted_reviewers, values_of
from parfocal_api.reviewed_layer import task_slide
from parfocal_api.tables import (
    AnnotationKind,
    DecisionValue,
    ResultStatus,
    annotations,
    project_classes,
    result_objects,
    result_set_classes,
    result_sets,
    review_decisions,
)
from parfocal_common import evaluation as engine
from parfocal_common.object_ids import Letter, ObjectId

BINS = 10
TOP_SCORE = 256
REGION = AnnotationKind.REGION.value
CELL = AnnotationKind.CELL.value

MODEL_AREAS = text(
    "WITH a AS (SELECT ST_Union(geometry) AS g FROM result_objects "
    "WHERE result_set_id = :set_a AND kind = 'region'), "
    "b AS (SELECT ST_Union(geometry) AS g FROM result_objects "
    "WHERE result_set_id = :set_b AND kind = 'region') "
    "SELECT COALESCE(ST_Area(a.g), 0) AS ai, COALESCE(ST_Area(b.g), 0) AS consensus, "
    "COALESCE(ST_Area(ST_Intersection(a.g, b.g)), 0) AS overlap FROM a, b"
)
ONLY_IN_A = text(
    "SELECT o.number FROM result_objects o WHERE o.result_set_id = :set_a "
    "AND o.kind = 'region' AND NOT EXISTS (SELECT 1 FROM result_objects p "
    "WHERE p.result_set_id = :set_b AND p.kind = 'region' "
    "AND ST_Intersects(o.geometry, p.geometry)) ORDER BY o.number"
)


class ClassCount(BaseModel):
    class_name: str
    count: int


class AiObjectAgreement(BaseModel):
    object: str
    agreement: Literal["both", "ai_only", "reviewer_only"]


class AiAgainstReviewed(BaseModel):
    dice: float | None
    cells_agree_percent: float | None
    objects: list[AiObjectAgreement]


class ModelAgainstModel(BaseModel):
    set_a_id: uuid.UUID | None
    set_b_id: uuid.UUID | None
    dice: float | None
    only_in_a: list[str]


class ReviewerObjectAgreement(BaseModel):
    object: str
    agreement: Literal["same", "split", "unsure"]


class SlideReviewers(BaseModel):
    user_ids: list[uuid.UUID]
    kappa: float | None
    objects: list[ReviewerObjectAgreement]


class SlideResultStats(BaseModel):
    task_id: uuid.UUID
    slide_id: uuid.UUID
    object_count: int = Field(ge=0)
    class_counts: list[ClassCount]
    score_bins: list[int]
    ai_vs_reviewed: AiAgainstReviewed
    model_vs_model: ModelAgainstModel
    reviewers: SlideReviewers


router = APIRouter(prefix="/api/review-tasks/{task_id}", tags=["review-tasks"])


def region_code(number: int) -> str:
    return ObjectId(Letter.REGION, number).text(ascii=True)


async def counts_of(
    connection: AsyncConnection, set_id: uuid.UUID
) -> tuple[int, list[ClassCount], list[int]]:
    total = await connection.scalar(
        select(result_sets.c.region_count + result_sets.c.cell_count).where(
            result_sets.c.id == set_id
        )
    )
    classes = [
        ClassCount(class_name=row.name, count=row.object_count)
        for row in await connection.execute(
            select(
                func.coalesce(project_classes.c.name, result_set_classes.c.source_name).label(
                    "name"
                ),
                result_set_classes.c.object_count,
            )
            .select_from(result_set_classes)
            .outerjoin(project_classes, project_classes.c.id == result_set_classes.c.class_id)
            .where(result_set_classes.c.result_set_id == set_id)
            .order_by(result_set_classes.c.object_count.desc(), result_set_classes.c.position)
        )
    ]
    bin_of = func.least(result_objects.c.score * BINS / TOP_SCORE, BINS - 1)
    bins = [0] * BINS
    for row in await connection.execute(
        select(bin_of.label("bin"), func.count().label("objects"))
        .where(result_objects.c.result_set_id == set_id, result_objects.c.score.is_not(None))
        .group_by(bin_of)
    ):
        bins[int(row.bin)] += int(row.objects)
    return int(total or 0), classes, bins


async def visible_people(
    connection: AsyncConnection, principal: Principal, row: Any, people: set[uuid.UUID]
) -> set[uuid.UUID]:
    me = user_of(principal)
    return {
        person
        for person in people
        if person == me
        or await sees_reviewer(
            connection, principal, row.project_id, row.task_id, row.slide_id, person
        )
    }


async def visible_decisions(
    connection: AsyncConnection, principal: Principal, row: Any
) -> list[Any]:
    rows = list(
        await connection.execute(
            select(
                review_decisions.c.user_id,
                review_decisions.c.kind,
                review_decisions.c.number,
                review_decisions.c.value,
            ).where(
                review_decisions.c.task_id == row.task_id,
                review_decisions.c.slide_id == row.slide_id,
            )
        )
    )
    shown = await visible_people(connection, principal, row, {item.user_id for item in rows})
    return [item for item in rows if item.user_id in shown]


async def added_regions(connection: AsyncConnection, principal: Principal, row: Any) -> list[Any]:
    rows = list(
        await connection.execute(
            select(annotations.c.id, annotations.c.number, annotations.c.created_by_user_id)
            .where(
                annotations.c.task_id == row.task_id,
                annotations.c.slide_id == row.slide_id,
                annotations.c.kind == AnnotationKind.REGION,
                annotations.c.deleted_at.is_(None),
                annotations.c.created_by_user_id.is_not(None),
            )
            .order_by(annotations.c.number)
        )
    )
    shown = await visible_people(
        connection, principal, row, {item.created_by_user_id for item in rows}
    )
    return [item for item in rows if item.created_by_user_id in shown]


def region_consensus(decisions: list[Any]) -> dict[int, engine.Consensus]:
    grouped: dict[int, dict[str, engine.ReviewDecision]] = {}
    for item in decisions:
        if item.kind == REGION:
            grouped.setdefault(item.number, {})[str(item.user_id)] = engine.ReviewDecision(
                item.value
            )
    return {
        number: engine.consensus(engine.AiObject("", REGION, number, "", given))
        for number, given in grouped.items()
    }


def cells_agree_percent(decisions: list[Any]) -> float | None:
    cells = [item.value for item in decisions if item.kind == CELL]
    if not cells:
        return None
    return round(100 * sum(value == DecisionValue.AGREE for value in cells) / len(cells), 1)


async def ai_against_reviewed(
    connection: AsyncConnection, principal: Principal, row: Any, set_id: uuid.UUID
) -> AiAgainstReviewed:
    decisions = await visible_decisions(connection, principal, row)
    consensus = region_consensus(decisions)
    added = await added_regions(connection, principal, row)
    numbers = list(
        await connection.scalars(
            select(result_objects.c.number)
            .where(result_objects.c.result_set_id == set_id, result_objects.c.kind == REGION)
            .order_by(result_objects.c.number)
        )
    )
    agreed = [n for n in numbers if consensus.get(n) is engine.Consensus.AGREE]
    objects = [
        AiObjectAgreement(object=region_code(n), agreement="both" if n in agreed else "ai_only")
        for n in numbers
        if consensus.get(n) in (engine.Consensus.AGREE, engine.Consensus.DISAGREE)
    ] + [
        AiObjectAgreement(
            object=added_code(AnnotationKind.REGION, item.number), agreement="reviewer_only"
        )
        for item in added
    ]
    dice = None
    if objects:
        areas = (
            await connection.execute(
                AREAS,
                {
                    "set_id": set_id,
                    "task_id": row.task_id,
                    "slide_id": row.slide_id,
                    "ai_numbers": numbers,
                    "agreed_numbers": agreed,
                    "added_ids": [item.id for item in added],
                },
            )
        ).one()
        found = engine.dice(engine.Areas("", "", areas.ai, areas.consensus, areas.overlap))
        dice = None if found is None else round(found, 4)
    return AiAgainstReviewed(
        dice=dice, cells_agree_percent=cells_agree_percent(decisions), objects=objects
    )


async def model_against_model(
    connection: AsyncConnection, row: Any, set_id: uuid.UUID
) -> ModelAgainstModel:
    other = await connection.scalar(
        select(result_sets.c.id)
        .where(
            result_sets.c.slide_id == row.slide_id,
            result_sets.c.id != set_id,
            result_sets.c.status == ResultStatus.READY,
            result_sets.c.deleted_at.is_(None),
        )
        .order_by(result_sets.c.created_at.desc(), result_sets.c.id)
        .limit(1)
    )
    if other is None:
        return ModelAgainstModel(set_a_id=set_id, set_b_id=None, dice=None, only_in_a=[])
    pair = {"set_a": set_id, "set_b": other}
    areas = (await connection.execute(MODEL_AREAS, pair)).one()
    found = engine.dice(engine.Areas("", "", areas.ai, areas.consensus, areas.overlap))
    only = [region_code(number) for (number,) in await connection.execute(ONLY_IN_A, pair)]
    return ModelAgainstModel(
        set_a_id=set_id,
        set_b_id=other,
        dice=None if found is None else round(found, 4),
        only_in_a=only,
    )


def pair_agreement(first: str, second: str) -> Literal["same", "split", "unsure"]:
    if DecisionValue.UNSURE in (first, second):
        return "unsure"
    return "same" if first == second else "split"


def regions_only(values: Mapping[tuple[str, int], str]) -> dict[int, str]:
    return {number: value for (kind, number), value in values.items() if kind == REGION}


async def reviewer_agreement(
    connection: AsyncConnection, principal: Principal, row: Any
) -> SlideReviewers:
    submitted = await submitted_reviewers(connection, row.task_id, row.slide_id)
    shown = await visible_people(connection, principal, row, set(submitted))
    pair = [person for person in submitted if person in shown][:2]
    if len(pair) < 2:
        return SlideReviewers(user_ids=[], kappa=None, objects=[])
    first = regions_only(await values_of(connection, row.task_id, row.slide_id, pair[0]))
    second = regions_only(await values_of(connection, row.task_id, row.slide_id, pair[1]))
    shared = sorted(first.keys() & second.keys())
    return SlideReviewers(
        user_ids=pair,
        kappa=engine.cohen([first[n] for n in shared], [second[n] for n in shared]),
        objects=[
            ReviewerObjectAgreement(
                object=region_code(n), agreement=pair_agreement(first[n], second[n])
            )
            for n in shared
        ],
    )


@router.get(
    "/slides/{slide_id}/result-stats",
    operation_id="getSlideResultStats",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_slide_result_stats(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> SlideResultStats:
    row = await task_slide(connection, principal, task_id, slide_id)
    hidden = await ai_hidden_on(connection, principal, row.project_id, slide_id)
    set_id = None if hidden else row.result_set_id
    reviewers = await reviewer_agreement(connection, principal, row)
    if set_id is None:
        return SlideResultStats(
            task_id=task_id,
            slide_id=slide_id,
            object_count=0,
            class_counts=[],
            score_bins=[0] * BINS,
            ai_vs_reviewed=AiAgainstReviewed(dice=None, cells_agree_percent=None, objects=[]),
            model_vs_model=ModelAgainstModel(set_a_id=None, set_b_id=None, dice=None, only_in_a=[]),
            reviewers=reviewers,
        )
    total, classes, bins = await counts_of(connection, set_id)
    return SlideResultStats(
        task_id=task_id,
        slide_id=slide_id,
        object_count=total,
        class_counts=classes,
        score_bins=bins,
        ai_vs_reviewed=await ai_against_reviewed(connection, principal, row, set_id),
        model_vs_model=await model_against_model(connection, row, set_id),
        reviewers=reviewers,
    )
