import json
import uuid
from enum import StrEnum
from typing import Any

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.blinding import (
    OtherReviewerError,
    require_ai_shown,
    require_seeing_reviewer,
    user_of,
)
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.evaluation import ai_objects, class_names, first_of_each_match, region_classes
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import BadRequestError
from parfocal_api.project_access import project_grant, reads_whole
from parfocal_api.projects import code_of
from parfocal_api.reviewed_layer import task_slide
from parfocal_api.tables import (
    annotations,
    cases,
    projects,
    result_objects,
    result_sets,
    review_edits,
    slides,
    verdicts,
)
from parfocal_common import evaluation as engine
from parfocal_common.object_ids import Letter, ObjectId, ObjectPath

OBJECT_TYPES = {"region": "annotation", "cell": "cell"}
LETTERS = {"region": Letter.REGION, "cell": Letter.CELL}


class ExportFormat(StrEnum):
    GEOJSON = "geojson"
    PARFOCAL = "parfocal"


class ConsensusForOwnersError(OtherReviewerError):
    code = "consensus-for-owners"
    title = "Only project owners and viewers export the consensus"


router = APIRouter(
    prefix="/api/review-tasks/{task_id}/slides/{slide_id}/export", tags=["review-tasks"]
)


def shape(value: str) -> dict[str, Any]:
    return json.loads(value)


async def path_parts(
    connection: AsyncConnection, slide_id: uuid.UUID
) -> tuple[str, str | None, str]:
    row = (
        await connection.execute(
            select(projects.c.number, cases.c.label.label("case_label"), slides.c.label)
            .join(projects, projects.c.id == slides.c.project_id)
            .outerjoin(cases, cases.c.id == slides.c.case_id)
            .where(slides.c.id == slide_id)
        )
    ).one()
    return code_of(row.number), row.case_label, row.label


def item(
    kind: str,
    number: int,
    geometry: dict[str, Any],
    class_name: str | None,
    where: tuple[str, str | None, str],
    details: dict[str, Any],
    *,
    person: bool = False,
) -> dict[str, Any]:
    object_id = ObjectId(LETTERS[kind], number, person=person)
    path = ObjectPath(where[0], where[1], where[2], object_id)
    return {
        "kind": kind,
        "id": object_id.text(ascii=True),
        "geometry": geometry,
        "class": class_name,
        "parfocal": {"id": object_id.text(ascii=True), "path": path.text(), **details},
    }


async def ai_regions(connection: AsyncConnection, set_id: uuid.UUID) -> list[Any]:
    return list(
        (
            await connection.execute(
                select(
                    result_objects.c.number,
                    func.ST_AsGeoJSON(result_objects.c.geometry).label("geojson"),
                )
                .where(result_objects.c.result_set_id == set_id, result_objects.c.kind == "region")
                .order_by(result_objects.c.number)
            )
        ).all()
    )


async def layer_items(
    connection: AsyncConnection, row: Any, reviewer: uuid.UUID, names: dict[uuid.UUID, str]
) -> list[dict[str, Any]]:
    where = await path_parts(connection, row.slide_id)
    classes = await region_classes(connection, row.task_id, names)
    edits = {
        (edit.kind, edit.number): edit
        for edit in await connection.execute(
            select(
                review_edits.c.kind,
                review_edits.c.number,
                review_edits.c.class_id,
                review_edits.c.deleted,
                func.ST_AsGeoJSON(review_edits.c.geometry).label("geojson"),
            ).where(
                review_edits.c.task_id == row.task_id,
                review_edits.c.slide_id == row.slide_id,
                review_edits.c.user_id == reviewer,
            )
        )
    }
    given = {
        (verdict.kind, verdict.number): verdict
        for verdict in await connection.execute(
            select(verdicts).where(
                verdicts.c.task_id == row.task_id,
                verdicts.c.slide_id == row.slide_id,
                verdicts.c.user_id == reviewer,
            )
        )
    }
    out: list[dict[str, Any]] = []
    for region in await ai_regions(connection, row.result_set_id):
        edit = edits.get(("region", region.number))
        if edit is not None and edit.deleted:
            continue
        ai_class = classes.get((row.slide_id, region.number))
        changed: list[str] = []
        if edit is not None and edit.class_id is not None:
            changed.append("retyped")
        if edit is not None and edit.geojson is not None:
            changed.append("reshaped")
        verdict = given.get(("region", region.number))
        out.append(
            item(
                "region",
                region.number,
                shape(edit.geojson) if edit is not None and edit.geojson else shape(region.geojson),
                names.get(edit.class_id) if edit is not None and edit.class_id else ai_class,
                where,
                {
                    "ai_class": ai_class,
                    "changed": changed,
                    "verdict": verdict.value if verdict else None,
                    "reason": verdict.reason if verdict else None,
                },
            )
        )
    for (kind, number), edit in sorted(edits.items()):
        if kind == "cell" and edit.geojson and not edit.deleted:
            out.append(
                item(
                    "cell",
                    number,
                    shape(edit.geojson),
                    names.get(edit.class_id) if edit.class_id else None,
                    where,
                    {"changed": ["reshaped"] + (["retyped"] if edit.class_id else [])},
                )
            )
    for added in await connection.execute(
        select(
            annotations.c.kind,
            annotations.c.number,
            annotations.c.class_id,
            func.ST_AsGeoJSON(annotations.c.geometry).label("geojson"),
        )
        .where(
            annotations.c.task_id == row.task_id,
            annotations.c.slide_id == row.slide_id,
            annotations.c.created_by_user_id == reviewer,
            annotations.c.deleted_at.is_(None),
            annotations.c.kind.in_(["region", "cell"]),
        )
        .order_by(annotations.c.kind, annotations.c.number)
    ):
        out.append(
            item(
                added.kind,
                added.number,
                shape(added.geojson),
                names.get(added.class_id) if added.class_id else None,
                where,
                {"changed": ["added"]},
                person=True,
            )
        )
    return out


async def consensus_items(
    connection: AsyncConnection, row: Any, names: dict[uuid.UUID, str]
) -> list[dict[str, Any]]:
    where = await path_parts(connection, row.slide_id)
    classes = await region_classes(connection, row.task_id, names)
    agreed = {
        item_.number
        for item_ in await ai_objects(connection, row.task_id, names)
        if item_.slide == str(row.slide_id)
        and item_.kind == "region"
        and engine.consensus(item_) is engine.Consensus.AGREE
    }
    reshaped: dict[int, str] = {}
    for edit in await connection.execute(
        select(review_edits.c.number, func.ST_AsGeoJSON(review_edits.c.geometry).label("geojson"))
        .where(
            review_edits.c.task_id == row.task_id,
            review_edits.c.slide_id == row.slide_id,
            review_edits.c.kind == "region",
            review_edits.c.geometry.is_not(None),
            review_edits.c.deleted.is_(False),
        )
        .order_by(review_edits.c.created_at, review_edits.c.user_id)
    ):
        reshaped.setdefault(edit.number, edit.geojson)
    out = [
        item(
            "region",
            region.number,
            shape(reshaped.get(region.number) or region.geojson),
            classes.get((row.slide_id, region.number)),
            where,
            {"consensus": "agree", "changed": ["reshaped"] if region.number in reshaped else []},
        )
        for region in await ai_regions(connection, row.result_set_id)
        if region.number in agreed
    ]
    rows = (
        await connection.execute(
            select(
                annotations.c.id,
                annotations.c.slide_id,
                annotations.c.kind,
                annotations.c.number,
                annotations.c.class_id,
                func.ST_AsGeoJSON(annotations.c.geometry).label("geojson"),
            )
            .where(
                annotations.c.task_id == row.task_id,
                annotations.c.deleted_at.is_(None),
                annotations.c.kind.in_(["region", "cell"]),
            )
            .order_by(annotations.c.created_at, annotations.c.id)
        )
    ).all()
    kept = await first_of_each_match(connection, row.task_id, [added.id for added in rows])
    out.extend(
        item(
            added.kind,
            added.number,
            shape(added.geojson),
            names.get(added.class_id) if added.class_id else None,
            where,
            {"consensus": "added", "changed": ["added"]},
            person=True,
        )
        for added in rows
        if added.slide_id == row.slide_id and added.id in kept
    )
    return out


def as_geojson(items: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": entry["id"],
                "geometry": entry["geometry"],
                "properties": {
                    "objectType": OBJECT_TYPES[entry["kind"]],
                    **({"classification": {"name": entry["class"]}} if entry["class"] else {}),
                    "parfocal": entry["parfocal"],
                },
            }
            for entry in items
        ],
    }


def as_parfocal(items: list[dict[str, Any]], model: str, slide_label: str) -> dict[str, Any]:
    return {
        "format": "parfocal-results",
        "version": 1,
        "slide": {"file_name": slide_label[:255]},
        "model": {"name": model[:120]},
        "objects": [
            {
                "kind": entry["kind"],
                "source_id": entry["id"],
                **({"class": entry["class"]} if entry["class"] else {}),
                "geometry": entry["geometry"],
                "properties": {"parfocal": entry["parfocal"]},
            }
            for entry in items
        ],
    }


@router.get(
    "", operation_id="exportReviewedLayer", **require(Permission.SEE_SLIDES, emergency=True)
)
async def export_reviewed_layer(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    format: ExportFormat = ExportFormat.GEOJSON,
    reviewer_id: uuid.UUID | None = None,
    consensus: bool = False,
) -> dict[str, Any]:
    row = await task_slide(connection, principal, task_id, slide_id)
    whole = reads_whole(
        await project_grant(connection, principal, row.project_id, Permission.SEE_SLIDES)
    )
    names = await class_names(connection, row.project_id)
    set_name = await connection.scalar(
        select(result_sets.c.name).where(result_sets.c.id == row.result_set_id)
    )
    if consensus:
        if not whole:
            raise ConsensusForOwnersError
        items = await consensus_items(connection, row, names)
        model = f"{set_name} consensus"
    else:
        reviewer = reviewer_id or user_of(principal)
        if reviewer is None:
            raise BadRequestError("Name the reviewer")
        await require_seeing_reviewer(
            connection, principal, row.project_id, task_id, slide_id, reviewer
        )
        await require_ai_shown(connection, principal, row.project_id, slide_id)
        items = await layer_items(connection, row, reviewer, names)
        model = f"{set_name} reviewed"
    if format is ExportFormat.GEOJSON:
        return as_geojson(items)
    _, _, slide_label = await path_parts(connection, slide_id)
    return as_parfocal(items, model, slide_label)
