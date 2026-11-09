import uuid
from datetime import date

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.evaluation import EvaluationHiddenError
from parfocal_api.evaluation_exports import (
    ExportKind,
    Version,
    pdf_of,
    svg_pages_of,
    task_report,
)
from parfocal_api.locales import DEFAULT_LOCALE, Locale
from parfocal_api.permissions import Permission, require
from parfocal_api.report_template import (
    RenderedReport,
    ReportClass,
    ReportData,
    ReportDecision,
    ReportObject,
    ReportOpinion,
    render_report,
)
from parfocal_api.review_order import Results
from parfocal_api.review_tasks import readable_task
from parfocal_api.study_templates import template_at
from parfocal_api.tables import TaskKind
from parfocal_api.task_kinds import review_only
from parfocal_common.report_blocks import ReportBlocks, ReportFormat

SAMPLE_CHECKSUM = "sha256:sample"
SAMPLE_DAY = date(2026, 1, 15)
SAMPLE_OBJECTS = (
    ReportObject("P1/C1/S1/T1", "S1", "region", "Tumor", 3, 0, 0, "agree"),
    ReportObject("P1/C1/S1/T2", "S1", "region", "Tumor", 1, 2, 0, "disagree"),
    ReportObject("P1/C1/S2/N1", "S2", "cell", "Lymphocyte", 2, 0, 1, "agree"),
    ReportObject("P1/C1/S2/N2", "S2", "cell", "Lymphocyte", 1, 1, 1, "unsure"),
)
SAMPLE_REVIEWERS = ("Reviewer A", "Reviewer B", "Reviewer C")
SAMPLE_DECISIONS = ("agree", "disagree", "unsure")


class ReportPreview(BaseModel):
    title: str
    file_name: str
    paper: str
    orientation: str
    page_count: int
    sample: bool
    pages: list[str]


class TemplatePreviewDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    blocks: ReportBlocks
    format: ReportFormat = ReportFormat()


def sample_data(draft: TemplatePreviewDraft) -> ReportData:
    return ReportData(
        project_name="Sample project",
        task_name=draft.name,
        version=1,
        checksum=SAMPLE_CHECKSUM,
        signed_off_on=SAMPLE_DAY,
        sample=True,
        classes=(
            ReportClass("region", "Tumor", 0.91, 0.87, 0.89),
            ReportClass("region", "Stroma", 0.84, 0.8, 0.82),
            ReportClass("cell", "Lymphocyte", 0.88, 0.79),
        ),
        fleiss_kappa=0.62,
        decisions={"agree": 18, "disagree": 5, "unsure": 3},
        headline={
            "sensitivity": 0.88,
            "precision": 0.83,
            "dice": 0.85,
            "kappa": 0.62,
            "cell-agreement": 0.79,
        },
        cell_agreement=0.74,
        reasons=(("Boundary is off", 3), ("Not this class", 2)),
        opinions=(ReportOpinion("Is the outline usable?", 3, 4.0),),
        blocks=tuple(draft.blocks),
        format=draft.format,
        objects=SAMPLE_OBJECTS,
        decision_rows=tuple(
            ReportDecision(found.object_id, reviewer, word)
            for found in SAMPLE_OBJECTS
            for reviewer, word in zip(SAMPLE_REVIEWERS, SAMPLE_DECISIONS, strict=True)
        ),
        decision_style="three-way",
        counts_as=("agree",),
        signed_by="Reviewer A",
    )


def preview_of(
    report: RenderedReport, version: Version, title: str, file_name: str, sample: bool
) -> ReportPreview:
    pages = svg_pages_of(report, version)
    return ReportPreview(
        title=title,
        file_name=file_name,
        paper=report.format.paper,
        orientation=report.format.orientation,
        page_count=len(pages),
        sample=sample,
        pages=pages,
    )


router = APIRouter(tags=["review-tasks"])


@router.get(
    "/api/review-tasks/{task_id}/evaluation/preview",
    operation_id="previewTaskEvaluation",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def preview_task_evaluation(
    task_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
    locale: Locale = DEFAULT_LOCALE,
) -> ReportPreview:
    task, whole = await readable_task(connection, principal, task_id)
    if task.kind != TaskKind.ANNOTATE:
        review_only(task.kind)
    if not whole:
        raise EvaluationHiddenError
    report, version = await task_report(connection, principal, task, results, locale)
    file_name = f"evaluation_v{version.number}_{ExportKind.PDF.value}"
    return preview_of(report, version, str(task.name), file_name, False)


def sample_file_name(draft: TemplatePreviewDraft) -> str:
    stem = "".join(char if char.isalnum() else "_" for char in draft.name).strip("_")
    return f"{stem or 'template'}_sample.pdf"


@router.post(
    "/api/study-templates/preview",
    operation_id="previewStudyTemplate",
    tags=["study-templates"],
    **require(Permission.REPORT_TEMPLATES, write=True),
)
async def preview_study_template(
    draft: TemplatePreviewDraft, locale: Locale = DEFAULT_LOCALE
) -> ReportPreview:
    version = Version(number=1, checksum=SAMPLE_CHECKSUM, signed_at=None)
    report = render_report(sample_data(draft), locale)
    return preview_of(report, version, draft.name, sample_file_name(draft), True)


@router.post(
    "/api/study-templates/preview/pdf",
    operation_id="downloadStudyTemplatePreview",
    tags=["study-templates"],
    response_class=Response,
    **require(Permission.REPORT_TEMPLATES, write=True),
)
async def download_study_template_preview(
    draft: TemplatePreviewDraft, locale: Locale = DEFAULT_LOCALE
) -> Response:
    version = Version(number=1, checksum=SAMPLE_CHECKSUM, signed_at=None)
    report = render_report(sample_data(draft), locale)
    return Response(
        content=pdf_of(report, version),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{sample_file_name(draft)}"'},
    )


async def saved_draft(connection: TenantConnection, template_id: uuid.UUID) -> TemplatePreviewDraft:
    template = await template_at(connection, template_id)
    return TemplatePreviewDraft(name=template.name, blocks=template.blocks, format=template.format)


@router.get(
    "/api/study-templates/{template_id}/preview",
    operation_id="previewSavedStudyTemplate",
    tags=["study-templates"],
    **require(Permission.REPORT_TEMPLATES),
)
async def preview_saved_study_template(
    template_id: uuid.UUID, connection: TenantConnection, locale: Locale = DEFAULT_LOCALE
) -> ReportPreview:
    return await preview_study_template(await saved_draft(connection, template_id), locale)


@router.get(
    "/api/study-templates/{template_id}/preview/pdf",
    operation_id="downloadSavedStudyTemplatePreview",
    tags=["study-templates"],
    response_class=Response,
    **require(Permission.REPORT_TEMPLATES),
)
async def download_saved_study_template_preview(
    template_id: uuid.UUID, connection: TenantConnection, locale: Locale = DEFAULT_LOCALE
) -> Response:
    return await download_study_template_preview(await saved_draft(connection, template_id), locale)
