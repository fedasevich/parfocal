import csv
import hashlib
import io
import json
import uuid
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.ai_changes import ai_changes, report_changes
from parfocal_api.blind_first import seen_by
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
from parfocal_api.principals import Principal
from parfocal_api.problems import ProblemError
from parfocal_api.report_template import (
    RenderedReport,
    ReportChange,
    ReportCompared,
    ReportData,
    ReportDecision,
    ReportObject,
    headline_of,
    render_report,
    report_data,
)
from parfocal_api.review_order import Results
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
    TaskKind,
    annotations,
    evaluation_changes,
    evaluation_versions,
    projects,
    result_sets,
    review_task_slides,
    slides,
    users,
    verdicts,
)
from parfocal_api.task_kinds import review_only
from parfocal_common import evaluation as engine
from parfocal_common.object_ids import ObjectId, ObjectPath
from parfocal_common.report_blocks import (
    BLOCKS,
    Comparison,
    ExpertChanges,
    ReportBlock,
    ReportFormat,
    SlideFigure,
    TextBlock,
)

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
    changes: tuple[ReportChange, ...] = ()

    def stamp(self) -> dict[str, Any]:
        return {
            "version": self.number,
            "checksum": self.checksum,
            "signed": self.signed_at is not None,
            "changes_after_sign_off": len(self.changes),
        }


router = APIRouter(prefix="/api/review-tasks/{task_id}/evaluation/exports", tags=["review-tasks"])


def checksum_of(evaluation: BaseModel) -> str:
    canonical = json.dumps(
        evaluation.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
    ).encode()
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


async def signed_row(connection: AsyncConnection, task: Any) -> Any | None:
    if task.signed_off_at is None:
        return None
    return (
        await connection.execute(
            select(evaluation_versions)
            .where(
                evaluation_versions.c.task_id == task.id,
                evaluation_versions.c.signed_at.is_not(None),
            )
            .order_by(evaluation_versions.c.number.desc())
            .limit(1)
        )
    ).one_or_none()


async def changes_since(
    connection: AsyncConnection, task_id: uuid.UUID, version: int
) -> tuple[ReportChange, ...]:
    rows = await connection.execute(
        select(
            evaluation_changes.c.object_id,
            evaluation_changes.c.change,
            evaluation_changes.c.reason,
            evaluation_changes.c.changed_at,
            slides.c.label,
            users.c.display_name,
        )
        .join(slides, slides.c.id == evaluation_changes.c.slide_id)
        .outerjoin(users, users.c.id == evaluation_changes.c.changed_by_user_id)
        .where(evaluation_changes.c.task_id == task_id, evaluation_changes.c.version == version)
        .order_by(evaluation_changes.c.changed_at, evaluation_changes.c.id)
    )
    return tuple(
        ReportChange(
            object_id=row.object_id,
            slide=row.label or "",
            change=row.change,
            reason=row.reason,
            by=row.display_name or "",
            on=row.changed_at.date(),
        )
        for row in rows
    )


async def version_of(connection: AsyncConnection, task: Any, evaluation: Evaluation) -> Version:
    stored = await signed_row(connection, task)
    if stored is not None:
        return Version(
            number=stored.number,
            checksum=stored.checksum,
            signed_at=stored.signed_at,
            changes=await changes_since(connection, task.id, stored.number),
        )
    return Version(number=1, checksum=checksum_of(evaluation), signed_at=task.signed_off_at)


async def signed_layout(
    connection: AsyncConnection, task: Any
) -> tuple[tuple[ReportBlock, ...], ReportFormat]:
    stored = await signed_row(connection, task)
    if stored is None or stored.blocks is None or stored.format is None:
        return await task_layout(connection, task)
    return tuple(BLOCKS.validate_python(stored.blocks)), ReportFormat.model_validate(stored.format)


async def task_layout(
    connection: AsyncConnection, task: Any
) -> tuple[tuple[ReportBlock, ...], ReportFormat]:
    if task.study_template_id is None:
        built_in = BUILT_INS[BuiltInTemplate.DETECTION]
        return tuple(built_in.blocks), built_in.format
    template = await template_at(connection, task.study_template_id, task.study_template_version)
    return tuple(template.blocks), template.format


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


def report_objects(rows: list[dict[str, Any]]) -> tuple[ReportObject, ...]:
    return tuple(
        ReportObject(
            object_id=row["object_id"],
            slide=row["object_id"].split("/")[-2],
            kind=row["kind"],
            class_name=row["class"],
            agree=row["agree"] or 0,
            disagree=row["disagree"] or 0,
            unsure=row["unsure"] or 0,
            consensus=row["consensus"],
        )
        for row in rows
    )


def report_decisions(rows: list[dict[str, Any]]) -> tuple[ReportDecision, ...]:
    letters = {
        reviewer: f"Reviewer {chr(65 + index)}"
        for index, reviewer in enumerate(sorted({str(row["reviewer_id"]) for row in rows}))
    }
    return tuple(
        ReportDecision(
            object_id=row["object_id"],
            reviewer=letters[str(row["reviewer_id"])],
            decision=row["decision"],
        )
        for row in rows
    )


async def compared_tasks(
    connection: AsyncConnection, principal: Any, blocks: tuple[ReportBlock, ...]
) -> dict[str, ReportCompared]:
    compared: dict[str, ReportCompared] = {}
    for block in blocks:
        if not isinstance(block, Comparison) or block.task_id is None:
            continue
        try:
            other, whole = await readable_task(connection, principal, block.task_id)
            review_only(other.kind)
        except ProblemError:
            continue
        if whole:
            found = await evaluate(connection, other)
            compared[str(block.task_id)] = ReportCompared(other.name, headline_of(found))
    return compared


async def rendered_report(
    connection: AsyncConnection,
    principal: Any,
    task: Any,
    evaluation: Evaluation,
    version: Version,
    locale: Locale,
) -> RenderedReport:
    project_name = await connection.scalar(
        select(projects.c.name).where(projects.c.id == task.project_id)
    )
    blocks, report_format = await signed_layout(connection, task)
    data = report_data(
        evaluation,
        str(project_name),
        task.name,
        version.number,
        version.signed_at.date() if version.signed_at else None,
        version.checksum,
        blocks,
        report_format,
    )
    data = replace(
        data,
        objects=report_objects(await object_rows(connection, task, version)),
        decision_rows=report_decisions(await decision_rows(connection, task, version))
        if "decisions" in report_format.appendices
        else (),
        compared=await compared_tasks(connection, principal, blocks),
        changes=version.changes,
    )
    return render_report(data, locale)


ANNOTATE_BLOCKS = (ExpertChanges, TextBlock, SlideFigure)
ANNOTATE_DEFAULT: tuple[ReportBlock, ...] = (
    ExpertChanges(kind="ai-changes", title="Changes to the AI by class"),
    ExpertChanges(kind="ai-changes", title="Changes to the AI by slide", group_by="slide"),
)


def annotate_layout(
    blocks: tuple[ReportBlock, ...], report_format: ReportFormat
) -> tuple[tuple[ReportBlock, ...], ReportFormat]:
    kept = tuple(block for block in blocks if isinstance(block, ANNOTATE_BLOCKS))
    if not any(isinstance(block, ExpertChanges) for block in kept):
        kept = (*ANNOTATE_DEFAULT, *kept)
    return kept, report_format.model_copy(update={"appendices": []})


async def annotate_report(
    connection: AsyncConnection,
    principal: Principal,
    task: Any,
    results: Results,
    locale: Locale,
) -> tuple[RenderedReport, Version]:
    found = await ai_changes(connection, task, results, seen_by(task.blind_first, principal))
    version = Version(number=1, checksum=checksum_of(found), signed_at=task.signed_off_at)
    project = (
        await connection.execute(
            select(projects.c.name, projects.c.sample).where(projects.c.id == task.project_id)
        )
    ).one()
    template_blocks, template_format = await task_layout(connection, task)
    blocks, report_format = annotate_layout(
        template_blocks if task.study_template_id is not None else (), template_format
    )
    data = ReportData(
        project_name=str(project.name),
        task_name=task.name,
        version=version.number,
        checksum=version.checksum,
        signed_off_on=version.signed_at.date() if version.signed_at else None,
        sample=bool(project.sample),
        classes=(),
        fleiss_kappa=None,
        decisions={},
        blocks=blocks,
        format=report_format,
        ai_changes=report_changes(found),
        review=False,
    )
    return render_report(data, locale), version


async def task_report(
    connection: AsyncConnection,
    principal: Any,
    task: Any,
    results: Results,
    locale: Locale,
) -> tuple[RenderedReport, Version]:
    if task.kind == TaskKind.ANNOTATE:
        return await annotate_report(connection, principal, task, results, locale)
    evaluation = await evaluate(connection, task)
    version = await version_of(connection, task, evaluation)
    return await rendered_report(connection, principal, task, evaluation, version, locale), version


def typst_options(report: RenderedReport, version: Version) -> dict[str, Any]:
    stamp = (
        int(version.signed_at.astimezone(UTC).timestamp()) if version.signed_at else DRAFT_TIMESTAMP
    )
    return {
        "sys_inputs": report.inputs,
        "ignore_system_fonts": True,
        "timestamp": stamp,
    }


def typst_module() -> Any:
    try:
        import typst
    except ImportError as missing:
        raise PdfUnavailableError from missing
    return typst


def pdf_of(report: RenderedReport, version: Version) -> bytes:
    return typst_module().compile(
        report.source.encode(), format="pdf", **typst_options(report, version)
    )


def svg_pages_of(report: RenderedReport, version: Version) -> list[str]:
    pages = typst_module().compile(
        report.source.encode(), format="svg", **typst_options(report, version)
    )
    return [page.decode() for page in pages]


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
    results: Results,
    locale: Locale = DEFAULT_LOCALE,
) -> Response:
    task, whole = await readable_task(connection, principal, task_id)
    if task.kind != TaskKind.ANNOTATE or kind is not ExportKind.PDF:
        review_only(task.kind)
    if not whole:
        raise EvaluationHiddenError
    if kind is ExportKind.PDF:
        report, version = await task_report(connection, principal, task, results, locale)
        return attachment(kind, pdf_of(report, version), version)
    evaluation = await evaluate(connection, task)
    version = await version_of(connection, task, evaluation)
    content: str | bytes
    match kind:
        case ExportKind.DECISIONS:
            content = csv_text(DECISION_COLUMNS, await decision_rows(connection, task, version))
        case ExportKind.OBJECTS:
            content = csv_text(OBJECT_COLUMNS, await object_rows(connection, task, version))
        case ExportKind.ANNOTATIONS_JSON:
            content = await annotations_json(connection, task, version)
        case ExportKind.ANNOTATIONS_GEOJSON:
            content = await annotations_geojson(connection, task, version)
    return attachment(kind, content, version)


def attachment(kind: ExportKind, content: str | bytes, version: Version) -> Response:
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
