import statistics
import uuid

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import bindparam, select, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.types import Integer, Uuid

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.opinions import form_of
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import ForbiddenError
from parfocal_api.review_tasks import readable_task
from parfocal_api.tables import (
    annotations,
    disagreement_decisions,
    opinions,
    project_classes,
    result_objects,
    result_set_classes,
    review_task_slides,
    verdicts,
)
from parfocal_common import evaluation as engine

UNCLASSIFIED = "unclassified"
CELL_PIXELS = 16.0


class RateOut(BaseModel):
    value: float | None
    numerator: int
    denominator: int


class ClassMetrics(BaseModel):
    kind: str
    class_name: str
    true_positives: int
    false_positives: int
    false_negatives: int
    unsure: int
    undecided: int
    precision: RateOut
    sensitivity: RateOut


class KappaOut(BaseModel):
    first: uuid.UUID
    second: uuid.UUID
    value: float | None
    objects: int


class OpinionOut(BaseModel):
    key: str
    count: int
    mean: float | None
    spread: float | None
    counts: dict[str, int]
    texts: list[str]


class Evaluation(BaseModel):
    task_id: uuid.UUID
    classes: list[ClassMetrics]
    overall: list[ClassMetrics]
    dice: dict[str, RateOut]
    kappa: list[KappaOut]
    mean_kappa: float | None
    fleiss_kappa: float | None
    cell_agreement_with_ai: RateOut
    cell_agreement_between_reviewers: RateOut
    reasons: list[tuple[str, int]]
    opinions: list[OpinionOut]


class EvaluationHiddenError(ForbiddenError):
    code = "evaluation-hidden"
    title = "Reviewers do not see the evaluation"


router = APIRouter(prefix="/api/review-tasks/{task_id}/evaluation", tags=["review-tasks"])


def rate(found: engine.Ratio) -> RateOut:
    return RateOut(value=found.value, numerator=found.numerator, denominator=found.denominator)


def metrics(kind: str, class_name: str, counts: engine.Counts) -> ClassMetrics:
    return ClassMetrics(
        kind=kind,
        class_name=class_name,
        true_positives=counts.true_positives,
        false_positives=counts.false_positives,
        false_negatives=counts.false_negatives,
        unsure=counts.unsure,
        undecided=counts.undecided,
        precision=rate(counts.precision),
        sensitivity=rate(counts.sensitivity),
    )


async def class_names(connection: AsyncConnection, project_id: uuid.UUID) -> dict[uuid.UUID, str]:
    rows = await connection.execute(
        select(project_classes.c.id, project_classes.c.name).where(
            project_classes.c.project_id == project_id
        )
    )
    return {row.id: row.name for row in rows}


async def region_classes(
    connection: AsyncConnection, task_id: uuid.UUID, names: dict[uuid.UUID, str]
) -> dict[tuple[uuid.UUID, int], str]:
    rows = await connection.execute(
        select(
            review_task_slides.c.slide_id,
            result_objects.c.number,
            result_set_classes.c.class_id,
            result_set_classes.c.source_name,
        )
        .join(result_objects, result_objects.c.result_set_id == review_task_slides.c.result_set_id)
        .outerjoin(
            result_set_classes,
            (result_set_classes.c.result_set_id == result_objects.c.result_set_id)
            & (result_set_classes.c.position == result_objects.c.class_index),
        )
        .where(review_task_slides.c.task_id == task_id, result_objects.c.kind == "region")
    )
    return {
        (row.slide_id, row.number): names.get(row.class_id, row.source_name or UNCLASSIFIED)
        if row.class_id
        else (row.source_name or UNCLASSIFIED)
        for row in rows
    }


async def ai_objects(
    connection: AsyncConnection, task_id: uuid.UUID, names: dict[uuid.UUID, str]
) -> list[engine.AiObject]:
    regions = await region_classes(connection, task_id, names)
    decisions = {
        (row.slide_id, row.kind, row.number): row.decision
        for row in await connection.execute(
            select(disagreement_decisions).where(disagreement_decisions.c.task_id == task_id)
        )
    }
    grouped: dict[tuple[uuid.UUID, str, int], dict[str, engine.Verdict]] = {}
    for row in await connection.execute(select(verdicts).where(verdicts.c.task_id == task_id)):
        grouped.setdefault((row.slide_id, row.kind, row.number), {})[str(row.user_id)] = (
            engine.Verdict(
                row.value,
                row.reason,
                names.get(row.reason_class_id) if row.reason_class_id else None,
            )
        )
    return [
        engine.AiObject(
            slide=str(slide_id),
            kind=kind,
            number=number,
            class_name=regions.get((slide_id, number), UNCLASSIFIED)
            if kind == "region"
            else UNCLASSIFIED,
            verdicts=given,
            decision=decisions.get((slide_id, kind, number)),
        )
        for (slide_id, kind, number), given in sorted(
            grouped.items(), key=lambda item: str(item[0])
        )
    ]


SAME_ADDED = text(
    "SELECT a.id AS first, b.id AS second FROM annotations a JOIN annotations b "
    "ON a.slide_id = b.slide_id AND a.kind = b.kind AND a.id < b.id "
    "AND a.created_by_user_id IS DISTINCT FROM b.created_by_user_id "
    "AND a.class_id IS NOT DISTINCT FROM b.class_id "
    "WHERE a.task_id = :task_id AND b.task_id = :task_id "
    "AND a.deleted_at IS NULL AND b.deleted_at IS NULL "
    "AND ((a.kind = 'region' AND ST_Intersects(a.geometry, b.geometry) "
    "AND ST_Area(ST_Intersection(a.geometry, b.geometry)) "
    ">= 0.5 * ST_Area(ST_Union(a.geometry, b.geometry))) "
    "OR (a.kind = 'cell' AND ST_DWithin(ST_Centroid(a.geometry), ST_Centroid(b.geometry), :cell)))"
)


async def added_objects(
    connection: AsyncConnection, task_id: uuid.UUID, names: dict[uuid.UUID, str]
) -> tuple[list[engine.Added], dict[tuple[uuid.UUID, str], list[uuid.UUID]]]:
    rows = (
        await connection.execute(
            select(
                annotations.c.id, annotations.c.slide_id, annotations.c.kind, annotations.c.class_id
            )
            .where(
                annotations.c.task_id == task_id,
                annotations.c.deleted_at.is_(None),
                annotations.c.kind.in_(["region", "cell"]),
            )
            .order_by(annotations.c.created_at, annotations.c.id)
        )
    ).all()
    parent = {row.id: row.id for row in rows}

    def root(item: uuid.UUID) -> uuid.UUID:
        while parent[item] != item:
            item = parent[item]
        return item

    for first, second in await connection.execute(
        SAME_ADDED, {"task_id": task_id, "cell": CELL_PIXELS}
    ):
        parent[root(second)] = root(first)
    kept = [row for row in rows if root(row.id) == row.id]
    region_ids: dict[tuple[uuid.UUID, str], list[uuid.UUID]] = {}
    for row in rows:
        if row.kind == "region":
            name = names.get(row.class_id, UNCLASSIFIED) if row.class_id else UNCLASSIFIED
            region_ids.setdefault((row.slide_id, name), []).append(row.id)
    return [
        engine.Added(
            str(row.slide_id),
            row.kind,
            names.get(row.class_id, UNCLASSIFIED) if row.class_id else UNCLASSIFIED,
        )
        for row in kept
    ], region_ids


AREAS = text(
    "WITH ai AS (SELECT ST_Union(geometry) AS g FROM result_objects "
    "WHERE result_set_id = :set_id AND kind = 'region' AND number = ANY(:ai_numbers)), "
    "agreed AS (SELECT COALESCE(edit.geometry, o.geometry) AS g FROM result_objects o "
    "LEFT JOIN LATERAL (SELECT e.geometry FROM review_edits e WHERE e.task_id = :task_id "
    "AND e.slide_id = :slide_id AND e.kind = 'region' AND e.number = o.number "
    "AND e.geometry IS NOT NULL AND NOT e.deleted ORDER BY e.created_at, e.user_id LIMIT 1) edit "
    "ON true WHERE o.result_set_id = :set_id AND o.kind = 'region' "
    "AND o.number = ANY(:agreed_numbers)), "
    "added AS (SELECT geometry AS g FROM annotations WHERE id = ANY(:added_ids)), "
    "consensus AS (SELECT ST_Union(g) AS g FROM (SELECT g FROM agreed UNION ALL "
    "SELECT g FROM added) AS parts) "
    "SELECT COALESCE(ST_Area(ai.g), 0) AS ai, COALESCE(ST_Area(consensus.g), 0) AS consensus, "
    "COALESCE(ST_Area(ST_Intersection(ai.g, consensus.g)), 0) AS overlap FROM ai, consensus"
).bindparams(
    bindparam("ai_numbers", type_=ARRAY(Integer)),
    bindparam("agreed_numbers", type_=ARRAY(Integer)),
    bindparam("added_ids", type_=ARRAY(Uuid())),
)


async def region_areas(
    connection: AsyncConnection,
    task_id: uuid.UUID,
    objects: list[engine.AiObject],
    added_regions: dict[tuple[uuid.UUID, str], list[uuid.UUID]],
    names: dict[uuid.UUID, str],
) -> list[engine.Areas]:
    sets = {
        row.slide_id: row.result_set_id
        for row in await connection.execute(
            select(review_task_slides.c.slide_id, review_task_slides.c.result_set_id).where(
                review_task_slides.c.task_id == task_id
            )
        )
    }
    classes = await region_classes(connection, task_id, names)
    agreed = {
        (uuid.UUID(item.slide), item.number)
        for item in objects
        if item.kind == "region" and engine.consensus(item) is engine.Consensus.AGREE
    }
    keys = {(slide, name) for (slide, _), name in classes.items()} | set(added_regions)
    found: list[engine.Areas] = []
    for slide_id, name in sorted(keys, key=str):
        ai_numbers = [n for (s, n), c in classes.items() if s == slide_id and c == name]
        row = (
            await connection.execute(
                AREAS,
                {
                    "set_id": sets[slide_id],
                    "task_id": task_id,
                    "slide_id": slide_id,
                    "ai_numbers": ai_numbers,
                    "agreed_numbers": [n for n in ai_numbers if (slide_id, n) in agreed],
                    "added_ids": added_regions.get((slide_id, name), []),
                },
            )
        ).one()
        found.append(engine.Areas(str(slide_id), name, row.ai, row.consensus, row.overlap))
    return found


async def opinion_summaries(connection: AsyncConnection, task_id: uuid.UUID) -> list[OpinionOut]:
    _, questions = await form_of(connection, task_id)
    stored = [
        row.answers
        for row in await connection.execute(
            select(opinions.c.answers).where(opinions.c.task_id == task_id)
        )
    ]
    out: list[OpinionOut] = []
    for question in questions:
        summary = engine.summarise(
            engine.Opinion(
                question.key, question.kind, [answers.get(question.key) for answers in stored]
            )
        )
        out.append(
            OpinionOut(
                key=summary.key,
                count=summary.count,
                mean=summary.mean,
                spread=summary.spread,
                counts=dict(summary.counts),
                texts=list(summary.texts),
            )
        )
    return out


def fleiss_of(objects: list[engine.AiObject]) -> float | None:
    reviewers = {person for item in objects for person in item.verdicts}
    if len(reviewers) < 3:
        return None
    full = [item for item in objects if set(item.verdicts) == reviewers]
    ratings = [
        {
            category: sum(v.value == category for v in item.verdicts.values())
            for category in engine.CATEGORIES
        }
        for item in full
    ]
    return engine.fleiss(ratings)


@router.get("", operation_id="getTaskEvaluation", **require(Permission.SEE_SLIDES, emergency=True))
async def get_task_evaluation(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> Evaluation:
    task, whole = await readable_task(connection, principal, task_id)
    if not whole:
        raise EvaluationHiddenError
    names = await class_names(connection, task.project_id)
    objects = await ai_objects(connection, task_id, names)
    added, added_regions = await added_objects(connection, task_id, names)
    table = engine.confusion(objects, added)
    pairs = engine.pairwise_kappa(objects)
    known = [pair.value for pair in pairs if pair.value is not None]
    with_ai, between = engine.cell_agreement(objects)
    areas = await region_areas(connection, task_id, objects, added_regions, names)
    return Evaluation(
        task_id=task_id,
        classes=[metrics(kind, name, counts) for (kind, name), counts in sorted(table.items())],
        overall=[metrics(kind, "all", engine.overall(table, kind)) for kind in ("region", "cell")],
        dice={name: rate(found) for name, found in engine.mean_dice(areas).items()},
        kappa=[
            KappaOut(
                first=uuid.UUID(pair.first),
                second=uuid.UUID(pair.second),
                value=pair.value,
                objects=pair.objects,
            )
            for pair in pairs
        ],
        mean_kappa=statistics.fmean(known) if known else None,
        fleiss_kappa=fleiss_of(objects),
        cell_agreement_with_ai=rate(with_ai),
        cell_agreement_between_reviewers=rate(between),
        reasons=engine.reasons(objects),
        opinions=await opinion_summaries(connection, task_id),
    )
