import csv
import hashlib
import io
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from fastapi import APIRouter
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.evaluation import (
    UNCLASSIFIED,
    Evaluation,
    EvaluationHiddenError,
    ai_objects,
    class_names,
    evaluate,
    first_of_each_match,
)
from parfocal_api.locales import DEFAULT_LOCALE, Locale
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import ProblemError
from parfocal_api.report_template import RenderedReport, render_report, report_data
from parfocal_api.review_tasks import readable_task
from parfocal_api.reviewed_export import (
    LETTERS,
    as_geojson,
    as_parfocal,
    consensus_items,
    path_parts,
)
from parfocal_api.study_templates import BUILT_INS, template_at
from parfocal_api.tables import (
    BuiltInTemplate,
    annotations,
    projects,
    result_sets,
    review_task_slides,
    verdicts,
)
from parfocal_common import evaluation as engine
from parfocal_common.object_ids import ObjectId, ObjectPath
from parfocal_common.report_blocks import ReportBlock

CHECKSUM_HEADER = "X-Parfocal-Evaluation-Checksum"
VERSION_HEADER = "X-Parfocal-Evaluation-Version"
DRAFT_TIMESTAMP = 946684800
DECISION_COLUMNS = (
    "evaluation_version",
    "evaluation_checksum",
    "object_id",
    "slide_id",
    "kind",
    "number",
    "class",
    "reviewer_id",
    "decision",
    "answer",
    "reasons",
    "reason_class",
    "consensus",
    "queue_decision",
)
OBJECT_COLUMNS = (
    "evaluation_version",
    "evaluation_checksum",
    "object_id",
    "slide_id",
    "kind",
    "number",
    "origin",
    "class",
    "reviewers",
    "agree",
    "disagree",
    "unsure",
    "consensus",
    "queue_decision",
)


class ExportKind(StrEnum):
    PDF = "report.pdf"
    DECISIONS = "decisions.csv"
    OBJECTS = "objects.csv"
    ANNOTATIONS_JSON = "annotations.json"
    ANNOTATIONS_GEOJSON = "annotations.geojson"


MEDIA_TYPES = {
    ExportKind.PDF: "application/pdf",
    ExportKind.DECISIONS: "text/csv; charset=utf-8",
    ExportKind.OBJECTS: "text/csv; charset=utf-8",
    ExportKind.ANNOTATIONS_JSON: "application/json",
    ExportKind.ANNOTATIONS_GEOJSON: "application/geo+json",
}


class PdfUnavailableError(ProblemError):
    status = 503
    code = "pdf-renderer-missing"
    title = "The PDF renderer is not installed here"


@dataclass(frozen=True)
class Version:
    number: int
    checksum: str
    signed_at: datetime | None

    def stamp(self) -> dict[str, Any]:
        return {
            "version": self.number,
            "checksum": self.checksum,
            "signed": self.signed_at is not None,
        }


router = APIRouter(prefix="/api/review-tasks/{task_id}/evaluation/exports", tags=["review-tasks"])


def checksum_of(evaluation: Evaluation) -> str:
    canonical = json.dumps(
        evaluation.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
    ).encode()
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def version_of(task: Any, evaluation: Evaluation) -> Version:
    return Version(number=1, checksum=checksum_of(evaluation), signed_at=task.signed_off_at)


async def task_blocks(connection: AsyncConnection, task: Any) -> tuple[ReportBlock, ...]:
    if task.study_template_id is None:
        return tuple(BUILT_INS[BuiltInTemplate.DETECTION].blocks)
    template = await template_at(connection, task.study_template_id, task.study_template_version)
    return tuple(template.blocks)


def csv_text(columns: tuple[str, ...], rows: list[dict[str, Any]]) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


async def slide_rows(connection: AsyncConnection, task_id: uuid.UUID) -> list[Any]:
    return list(
        (
            await connection.execute(
                select(
                    review_task_slides.c.task_id,
                    review_task_slides.c.slide_id,
                    review_task_slides.c.result_set_id,
                )
                .where(review_task_slides.c.task_id == task_id)
                .order_by(review_task_slides.c.slide_id)
            )
        ).all()
    )


async def paths_of(
    connection: AsyncConnection, slide_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, str | None, str]]:
    return {slide_id: await path_parts(connection, slide_id) for slide_id in slide_ids}


def full_id(where: tuple[str, str | None, str], kind: str, number: int, person: bool) -> str:
    return ObjectPath(
        where[0], where[1], where[2], ObjectId(LETTERS[kind], number, person=person)
    ).text()


async def decision_rows(
    connection: AsyncConnection, task: Any, version: Version
) -> list[dict[str, Any]]:
    names = await class_names(connection, task.project_id)
    objects = {
        (uuid.UUID(item.slide), item.kind, item.number): item
        for item in await ai_objects(connection, task.id, names)
    }
    given = (
        await connection.execute(
            select(verdicts)
            .where(verdicts.c.task_id == task.id)
            .order_by(verdicts.c.slide_id, verdicts.c.kind, verdicts.c.number, verdicts.c.user_id)
        )
    ).all()
    where = await paths_of(connection, sorted({row.slide_id for row in given}))
    rows: list[dict[str, Any]] = []
    for row in given:
        item = objects[(row.slide_id, row.kind, row.number)]
        rows.append(
            {
                "evaluation_version": version.number,
                "evaluation_checksum": version.checksum,
                "object_id": full_id(where[row.slide_id], row.kind, row.number, False),
                "slide_id": row.slide_id,
                "kind": row.kind,
                "number": row.number,
                "class": item.class_name,
                "reviewer_id": row.user_id,
                "decision": row.value,
                "answer": names.get(row.answer_class_id, row.answer)
                if row.answer_class_id
                else row.answer,
                "reasons": ";".join(row.reasons),
                "reason_class": names.get(row.reason_class_id, "") if row.reason_class_id else "",
                "consensus": engine.consensus(item).value,
                "queue_decision": item.decision or "",
            }
        )
    return sorted(rows, key=lambda found: (found["object_id"], str(found["reviewer_id"])))


async def object_rows(
    connection: AsyncConnection, task: Any, version: Version
) -> list[dict[str, Any]]:
    names = await class_names(connection, task.project_id)
    objects = await ai_objects(connection, task.id, names)
    added = (
        await connection.execute(
            select(
                annotations.c.id,
                annotations.c.slide_id,
                annotations.c.kind,
                annotations.c.number,
                annotations.c.class_id,
            )
            .where(
                annotations.c.task_id == task.id,
                annotations.c.deleted_at.is_(None),
                annotations.c.kind.in_(["region", "cell"]),
            )
            .order_by(annotations.c.created_at, annotations.c.id)
        )
    ).all()
    kept = await first_of_each_match(connection, task.id, [row.id for row in added])
    slide_ids = {uuid.UUID(item.slide) for item in objects} | {row.slide_id for row in added}
    where = await paths_of(connection, sorted(slide_ids))
    stamp = {"evaluation_version": version.number, "evaluation_checksum": version.checksum}
    rows: list[dict[str, Any]] = []
    for item in objects:
        slide_id = uuid.UUID(item.slide)
        values = [given.value for given in item.verdicts.values()]
        rows.append(
            {
                **stamp,
                "object_id": full_id(where[slide_id], item.kind, item.number, False),
                "slide_id": slide_id,
                "kind": item.kind,
                "number": item.number,
                "origin": "ai",
                "class": item.class_name,
                "reviewers": len(values),
                "agree": values.count(engine.AGREE),
                "disagree": values.count(engine.DISAGREE),
                "unsure": values.count(engine.UNSURE),
                "consensus": engine.consensus(item).value,
                "queue_decision": item.decision or "",
            }
        )
    for row in added:
        if row.id in kept:
            rows.append(
                {
                    **stamp,
                    "object_id": full_id(where[row.slide_id], row.kind, row.number, True),
                    "slide_id": row.slide_id,
                    "kind": row.kind,
                    "number": row.number,
                    "origin": "added",
                    "class": names.get(row.class_id, UNCLASSIFIED)
                    if row.class_id
                    else UNCLASSIFIED,
                    "reviewers": "",
                    "agree": "",
                    "disagree": "",
                    "unsure": "",
                    "consensus": "added",
                    "queue_decision": "",
                }
            )
    return sorted(rows, key=lambda found: found["object_id"])


async def annotation_layers(
    connection: AsyncConnection, task: Any
) -> list[tuple[Any, list[dict[str, Any]]]]:
    names = await class_names(connection, task.project_id)
    return [
        (row, await consensus_items(connection, row, names))
        for row in await slide_rows(connection, task.id)
    ]


async def annotations_json(connection: AsyncConnection, task: Any, version: Version) -> str:
    slides_out: list[dict[str, Any]] = []
    for row, items in await annotation_layers(connection, task):
        set_name = await connection.scalar(
            select(result_sets.c.name).where(result_sets.c.id == row.result_set_id)
        )
        _, _, label = await path_parts(connection, row.slide_id)
        slides_out.append(as_parfocal(items, f"{set_name} consensus", label))
    return json.dumps(
        {
            "format": "parfocal-evaluation-annotations",
            "version": 1,
            "evaluation": version.stamp(),
            "slides": slides_out,
        },
        ensure_ascii=False,
    )


async def annotations_geojson(connection: AsyncConnection, task: Any, version: Version) -> str:
    items = [item for _, found in await annotation_layers(connection, task) for item in found]
    return json.dumps(
        {**as_geojson(items), "parfocal": {"evaluation": version.stamp()}}, ensure_ascii=False
    )


async def rendered_report(
    connection: AsyncConnection,
    task: Any,
    evaluation: Evaluation,
    version: Version,
    locale: Locale,
) -> RenderedReport:
    project_name = await connection.scalar(
        select(projects.c.name).where(projects.c.id == task.project_id)
    )
    data = report_data(
        evaluation,
        str(project_name),
        task.name,
        version.number,
        version.signed_at.date() if version.signed_at else None,
        version.checksum,
        await task_blocks(connection, task),
    )
    return render_report(data, locale)


def pdf_of(report: RenderedReport, version: Version) -> bytes:
    try:
        import typst
    except ImportError as missing:
        raise PdfUnavailableError from missing
    stamp = (
        int(version.signed_at.astimezone(UTC).timestamp()) if version.signed_at else DRAFT_TIMESTAMP
    )
    return typst.compile(
        report.source.encode(),
        format="pdf",
        sys_inputs=report.inputs,
        ignore_system_fonts=True,
        timestamp=stamp,
    )


@router.get(
    "/{kind}",
    operation_id="exportTaskEvaluation",
    response_class=Response,
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def export_task_evaluation(
    task_id: uuid.UUID,
    kind: ExportKind,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    locale: Locale = DEFAULT_LOCALE,
) -> Response:
    task, whole = await readable_task(connection, principal, task_id)
    if not whole:
        raise EvaluationHiddenError
    evaluation = await evaluate(connection, task)
    version = version_of(task, evaluation)
    content: str | bytes
    match kind:
        case ExportKind.PDF:
            report = await rendered_report(connection, task, evaluation, version, locale)
            content = pdf_of(report, version)
        case ExportKind.DECISIONS:
            content = csv_text(DECISION_COLUMNS, await decision_rows(connection, task, version))
        case ExportKind.OBJECTS:
            content = csv_text(OBJECT_COLUMNS, await object_rows(connection, task, version))
        case ExportKind.ANNOTATIONS_JSON:
            content = await annotations_json(connection, task, version)
        case ExportKind.ANNOTATIONS_GEOJSON:
            content = await annotations_geojson(connection, task, version)
    file_name = f"evaluation_v{version.number}_{kind.value}"
    return Response(
        content=content,
        media_type=MEDIA_TYPES[kind],
        headers={
            "Content-Disposition": f'attachment; filename="{file_name}"',
            CHECKSUM_HEADER: version.checksum,
            VERSION_HEADER: str(version.number),
        },
    )
