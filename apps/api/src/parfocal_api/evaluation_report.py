import uuid
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.evaluation import EvaluationHiddenError, ai_objects, class_names
from parfocal_api.evaluation_exports import signed_layout
from parfocal_api.evaluation_versions import (
    EvaluationChange,
    as_change,
    changes_of,
    labels_of,
    last_signed,
    open_draft,
    result_set_of,
    reviewers_of,
    versions_of,
)
from parfocal_api.my_work import ProjectRef
from parfocal_api.opinion_forms import form_of
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError
from parfocal_api.projects import code_of
from parfocal_api.review_tasks import code_of as task_code_of
from parfocal_api.review_tasks import readable_task
from parfocal_api.study_templates import BUILT_INS, template_at
from parfocal_api.tables import (
    BuiltInTemplate,
    DecisionValue,
    adjudications,
    projects,
    review_task_slides,
    tenants,
)
from parfocal_api.task_kinds import review_only
from parfocal_common import evaluation as engine
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.report_blocks import ReportBlocks, ReportFormat

WORST_ROWS = 100
LETTERS = {"region": Letter.REGION, "cell": Letter.CELL}
DOWNLOAD_LABELS = {
    "pdf": "PDF, this layout",
    "docx": "Word, this layout, editable",
    "html": "Web page, this layout",
    "decisions": "Decisions per object, CSV",
    "objects": "Objects with full IDs, CSV",
    "geojson": "Reviewed annotations, GeoJSON",
    "json": "Reviewed annotations, JSON",
}


class EvaluationReportLab(BaseModel):
    name: str
    short: str


class EvaluationReportTemplate(BaseModel):
    id: str
    name: str
    version: int
    latest_version: int
    retired_on: date | None
    blocks: ReportBlocks
    format: ReportFormat


class EvaluationReportDownload(BaseModel):
    key: str
    label: str


class EvaluationReportConfusion(BaseModel):
    classes: list[str]
    counts: list[list[int]]


class EvaluationReportAnswer(BaseModel):
    user_id: uuid.UUID
    raw: DecisionValue


class EvaluationReportWorst(BaseModel):
    object: str
    what: str
    answers: list[EvaluationReportAnswer]


class EvaluationReport(BaseModel):
    task_id: uuid.UUID
    task_code: str
    round_name: str
    model: str
    project: ProjectRef
    lab: EvaluationReportLab
    slides: int
    objects: int
    reviewer_ids: list[uuid.UUID]
    adjudicators: int
    version: int
    signed_at: datetime | None
    signed_by_user_id: uuid.UUID | None
    template: EvaluationReportTemplate
    formats: list[EvaluationReportDownload]
    confusion: EvaluationReportConfusion
    worst: list[EvaluationReportWorst]
    opinion_question: str
    changes: list[EvaluationChange]


router = APIRouter(tags=["review-tasks"])


def short_of(name: str) -> str:
    return "".join(word[0] for word in name.split() if word[:1].isalnum())[:3].upper()


def worst_of(objects: list[engine.AiObject]) -> list[EvaluationReportWorst]:
    decided = [item for item in objects if item.decisions]

    def count(item: engine.AiObject, value: str) -> int:
        return sum(given.value == value for given in item.decisions.values())

    ranked = sorted(
        decided,
        key=lambda item: (
            -count(item, engine.DISAGREE),
            -count(item, engine.UNSURE),
            item.slide,
            item.kind,
            item.number,
        ),
    )
    return [
        EvaluationReportWorst(
            object=ObjectId(LETTERS[item.kind], item.number).text(ascii=True),
            what=f"{item.class_name[:1].upper()}{item.class_name[1:]} {item.kind}",
            answers=[
                EvaluationReportAnswer(user_id=uuid.UUID(user_id), raw=DecisionValue(given.value))
                for user_id, given in sorted(item.decisions.items())
            ],
        )
        for item in ranked[:WORST_ROWS]
        if item.kind in LETTERS
    ]


async def template_facts(
    connection: AsyncConnection, task: Any
) -> tuple[str, str, int, int, date | None]:
    if task.study_template_id is None:
        built_in = BUILT_INS[BuiltInTemplate.DETECTION]
        return BuiltInTemplate.DETECTION.value, built_in.name, 1, 1, None
    used = await template_at(connection, task.study_template_id, task.study_template_version)
    latest = await template_at(connection, task.study_template_id)
    retired = used.retired_at.date() if used.retired_at else None
    return str(used.id), used.name, used.version, latest.version, retired


async def opinion_question_of(connection: AsyncConnection, task: Any) -> str:
    try:
        form = await form_of(connection, task.project_id, task.opinion_form_version)
    except NotFoundError:
        return ""
    return form.questions[0].label if form.questions else ""


@router.get(
    "/api/review-tasks/{task_id}/evaluation-report",
    operation_id="getEvaluationReport",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_evaluation_report(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> EvaluationReport:
    task, whole = await readable_task(connection, principal, task_id)
    review_only(task.kind)
    if not whole:
        raise EvaluationHiddenError
    place = (
        await connection.execute(
            select(projects.c.number, projects.c.name, tenants.c.name.label("lab"))
            .join(tenants, tenants.c.id == projects.c.tenant_id)
            .where(projects.c.id == task.project_id)
        )
    ).one()
    versions = await versions_of(connection, task_id)
    signed = last_signed(versions)
    draft = open_draft(versions)
    blocks, report_format = await signed_layout(connection, task)
    template_id, name, version, latest, retired = await template_facts(connection, task)
    facts = await result_set_of(connection, task)
    changes = await changes_of(connection, task_id, signed.number) if signed else []
    labels = await labels_of(connection, {row.slide_id for row in changes})
    objects = await ai_objects(connection, task_id, await class_names(connection, task.project_id))
    return EvaluationReport(
        task_id=task_id,
        task_code=task_code_of(task.number),
        round_name=task.name,
        model=facts.name,
        project=ProjectRef(id=task.project_id, code=code_of(place.number), name=place.name),
        lab=EvaluationReportLab(name=place.lab, short=short_of(place.lab)),
        slides=await connection.scalar(
            select(func.count()).where(review_task_slides.c.task_id == task_id)
        )
        or 0,
        objects=facts.objects,
        reviewer_ids=await reviewers_of(connection, task_id),
        adjudicators=await connection.scalar(
            select(func.count(func.distinct(adjudications.c.adjudicator_user_id))).where(
                adjudications.c.task_id == task_id
            )
        )
        or 0,
        version=signed.number if signed else draft.number if draft else 1,
        signed_at=signed.signed_at if signed else None,
        signed_by_user_id=signed.signed_by_user_id if signed else None,
        template=EvaluationReportTemplate(
            id=template_id,
            name=name,
            version=version,
            latest_version=latest,
            retired_on=retired,
            blocks=list(blocks),
            format=report_format,
        ),
        formats=[
            EvaluationReportDownload(key=key, label=DOWNLOAD_LABELS[key])
            for key in report_format.downloads
        ],
        confusion=EvaluationReportConfusion(classes=[], counts=[]),
        worst=worst_of(objects),
        opinion_question=await opinion_question_of(connection, task),
        changes=[as_change(row, labels) for row in changes],
    )
