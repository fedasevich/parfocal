import re
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.cases import CASE_SLIDE_ORDER, case_detail, keyring_of
from parfocal_api.clinical_reports import (
    TEMPLATES,
    CaseReport,
    CaseReportReturn,
    CaseReportSignOut,
    CaseReportStep,
    CaseReportValues,
    NotCosignerError,
    Reason,
    WrongStateError,
    clinical_case,
    report_of,
    report_row,
    return_clinical_report,
    sign_clinical_report,
    user_id_of,
    writable,
)
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.evaluation_versions import ConfirmedWith
from parfocal_api.my_work import ProjectRef
from parfocal_api.notifications import member_of
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError
from parfocal_api.projects import project_of
from parfocal_api.tables import (
    CaseReportState,
    ClinicalTemplate,
    DecisionValue,
    NodeCategory,
    ProjectRole,
    SignOutRight,
    cases,
    review_assignments,
    slides,
)

STEP_LABELS = {
    CaseReportStep.FINDINGS: "Findings",
    CaseReportStep.STAGING: "Staging",
    CaseReportStep.TEXT: "Report text",
    CaseReportStep.SIGN: "Sign out",
}
NODE_STANDARDS = [
    ("ICCR", "Surgically removed lymph nodes for breast tumours, 1st ed. v1.2"),
    ("CAP", "Synoptic format and element names, Breast Invasive Resection 4.11"),
    ("TNM", "UICC and AJCC 8th edition, pN with (sn) and (i+)"),
]
HAEMATOXYLIN_EOSIN = "H&E"

type ObjectState = Literal["agree", "disagree", "open"]

STATES: dict[DecisionValue, ObjectState] = {
    DecisionValue.AGREE: "agree",
    DecisionValue.DISAGREE: "disagree",
    DecisionValue.UNSURE: "open",
}


class ClinicalDeposit(BaseModel):
    id: str
    slide: str
    object_id: str | None
    size_mm: str
    note: str


class ClinicalValues(BaseModel):
    specimen: str
    deposits: list[ClinicalDeposit]
    category: Literal["macro", "micro", "itc"] | None
    examined: str
    extranodal: Literal["present", "absent", "na"] | None
    diagnosis: str | None
    microscopic: str
    comment: str


class ClinicalCells(BaseModel):
    agree: int
    of: int


class ClinicalReportCase(BaseModel):
    label: str
    site: str
    clinical_history: str
    received: str
    requested_by: str
    assigned_user_ids: list[uuid.UUID]
    examined: int | None
    cells: ClinicalCells | None


class ClinicalReportStep(BaseModel):
    key: CaseReportStep
    label: str


class ClinicalReportTemplate(BaseModel):
    key: ClinicalTemplate
    name: str
    version: str
    steps: list[ClinicalReportStep]
    standards: list[tuple[str, str]]


class ClinicalReportSlide(BaseModel):
    key: str
    id: uuid.UUID
    label: str
    node: int
    short: str


class ClinicalReportDecision(BaseModel):
    object_id: str
    counts_as: DecisionValue
    why: str


class ClinicalReportObject(BaseModel):
    slide: str
    object_id: str
    size_mm: float
    ai_size_mm: float
    measured_by: Literal["you", "ai"]
    state: ObjectState


class ClinicalReportMember(BaseModel):
    user_id: uuid.UUID
    role: ProjectRole
    sign_out: SignOutRight
    covers_case: bool


class ClinicalReport(BaseModel):
    id: str
    project: ProjectRef
    case: ClinicalReportCase
    template: ClinicalReportTemplate
    slide: str
    slides: list[ClinicalReportSlide]
    decisions: list[ClinicalReportDecision]
    objects: list[ClinicalReportObject]
    members: list[ClinicalReportMember]
    author_user_id: uuid.UUID
    values: ClinicalValues


class CosignReviewTemplate(BaseModel):
    name: str
    version: str


class CosignReviewSlide(BaseModel):
    key: str
    node: int
    short: str


class CosignAiDeposit(BaseModel):
    slide: str
    object_id: str
    size_mm: float


class CosignAi(BaseModel):
    largest_mm: float
    deposits: list[CosignAiDeposit]


class CosignReview(BaseModel):
    id: str
    project: ProjectRef
    case_label: str
    template: CosignReviewTemplate
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    sent_at: datetime
    values: ClinicalValues
    slides: list[CosignReviewSlide]
    ai: CosignAi
    co_signer_covers_case: bool


class ClinicalSignature(BaseModel):
    version: int
    signed_by_user_id: uuid.UUID | None
    reported_by_user_id: uuid.UUID | None
    signed_at: datetime


class CosignReturn(BaseModel):
    id: str
    note: str
    returned_at: datetime


class CosignReturnRequest(BaseModel):
    note: Reason


class CosignSignRequest(BaseModel):
    method: ConfirmedWith = "sso"


router = APIRouter(
    prefix="/api/projects/{project_id}/slides/{slide_id}/clinical-report",
    tags=["clinical-reports"],
)


async def case_of_slide(
    connection: AsyncConnection, project_id: uuid.UUID, slide_id: uuid.UUID
) -> uuid.UUID:
    case_id = await connection.scalar(
        select(slides.c.case_id).where(
            slides.c.id == slide_id,
            slides.c.project_id == project_id,
            slides.c.deleted_at.is_(None),
        )
    )
    if case_id is None:
        raise NotFoundError("Slide not found in a case")
    return case_id


def size_text(size: float | None) -> str:
    if size is None:
        return ""
    text = str(size)
    return text.removesuffix(".0")


def clinical_values(values: CaseReportValues) -> ClinicalValues:
    category = values.category
    return ClinicalValues(
        specimen=values.specimen or "",
        deposits=[
            ClinicalDeposit(
                id=str(deposit.id),
                slide=str(deposit.slide_id),
                object_id=deposit.object_id,
                size_mm=size_text(deposit.size_mm),
                note=deposit.note or "",
            )
            for deposit in values.deposits
        ],
        category=None if category in (None, NodeCategory.NONE) else category.value,
        examined="" if values.nodes_examined is None else str(values.nodes_examined),
        extranodal=values.extranodal.value if values.extranodal else None,
        diagnosis=values.diagnosis,
        microscopic=values.microscopic or "",
        comment=values.comment or "",
    )


def node_of(slide: Any, blocks: list[uuid.UUID]) -> int:
    if slide.block_id is not None:
        return blocks.index(slide.block_id) + 1
    found = re.search(r"\d+", slide.label or "")
    return int(found.group()) if found else 1


def short_of(slide: Any) -> str:
    label = slide.label or ""
    return label if slide.stain == HAEMATOXYLIN_EOSIN else f"{label} {slide.stain}"


def slides_of(case_slides: Sequence[Any]) -> list[ClinicalReportSlide]:
    blocks = list(dict.fromkeys(slide.block_id for slide in case_slides if slide.block_id))
    return [
        ClinicalReportSlide(
            key=str(slide.id),
            id=slide.id,
            label=f"{slide.label or ''} · {slide.stain}",
            node=node_of(slide, blocks),
            short=short_of(slide),
        )
        for slide in case_slides
    ]


def objects_of(report: CaseReport) -> list[ClinicalReportObject]:
    measured = {
        (item.slide_id, item.object_id): item.length_mm for item in report.findings.measurements
    }
    found: list[tuple[uuid.UUID, str, float, ObjectState]] = [
        (
            item.slide_id,
            item.object_id,
            measured.get((item.slide_id, item.object_id)) or 0.0,
            STATES[item.decision],
        )
        for item in report.findings.decisions
    ]
    decided = {(slide, object_id) for slide, object_id, _, _ in found}
    found.extend(
        (item.slide_id, item.object_id, item.length_mm or 0.0, STATES[DecisionValue.UNSURE])
        for item in report.findings.measurements
        if (item.slide_id, item.object_id) not in decided
    )
    return [
        ClinicalReportObject(
            slide=str(slide),
            object_id=object_id,
            size_mm=size,
            ai_size_mm=size,
            measured_by="you" if size > 0 else "ai",
            state=state,
        )
        for slide, object_id, size, state in found
    ]


async def assigned_of(connection: AsyncConnection, case_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await connection.execute(
        select(review_assignments.c.user_id)
        .join(slides, slides.c.id == review_assignments.c.slide_id)
        .where(slides.c.case_id == case_id, slides.c.deleted_at.is_(None))
        .distinct()
        .order_by(review_assignments.c.user_id)
    )
    return [row.user_id for row in rows]


@router.get(
    "",
    operation_id="getClinicalReport",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_clinical_report(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ClinicalReport:
    case_id = await case_of_slide(connection, project_id, slide_id)
    await clinical_case(connection, principal, project_id, case_id)
    report = await report_of(connection, case_id)
    project = await project_of(connection, principal, project_id)
    detail = await case_detail(connection, keyring_of(request), principal, case_id)
    specimen = detail.specimens[0] if detail.specimens else None
    received = specimen.received_at if specimen else None
    spec = TEMPLATES[report.template.key]
    shown = slides_of(detail.slides)
    return ClinicalReport(
        id=str(report.id),
        project=ProjectRef(id=project.id, code=project.code, name=project.name),
        case=ClinicalReportCase(
            label=detail.label,
            site=(specimen.site if specimen else None) or report.specimen or detail.label,
            clinical_history=detail.clinical_note or "",
            received=received.isoformat() if received else "",
            requested_by="",
            assigned_user_ids=await assigned_of(connection, case_id),
            examined=report.nodes_examined,
            cells=None,
        ),
        template=ClinicalReportTemplate(
            key=report.template.key,
            name=spec.name,
            version=f"v{report.template.version}",
            steps=[ClinicalReportStep(key=step, label=STEP_LABELS[step]) for step in spec.steps],
            standards=NODE_STANDARDS
            if report.template.key is ClinicalTemplate.SENTINEL_NODE
            else [],
        ),
        slide=shown[0].short if shown else "",
        slides=shown,
        decisions=[
            ClinicalReportDecision(object_id=item.object_id, counts_as=item.decision, why="")
            for item in report.findings.decisions
        ],
        objects=objects_of(report),
        members=[
            ClinicalReportMember(
                user_id=member.user_id,
                role=member.role,
                sign_out=member.sign_out or SignOutRight.NEVER,
                covers_case=member.user_id in report.signers,
            )
            for member in project.members
        ],
        author_user_id=member_of(principal).user_id,
        values=clinical_values(report),
    )


@router.get(
    "/cosign-request",
    operation_id="getCosignReview",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_cosign_review(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CosignReview:
    case_id = await case_of_slide(connection, project_id, slide_id)
    await clinical_case(connection, principal, project_id, case_id)
    report = await report_of(connection, case_id)
    if (
        report.state is not CaseReportState.SENT
        or report.cosigner_user_id is None
        or report.sent_by_user_id is None
    ):
        raise NotFoundError("This report is not waiting for a co-sign")
    project = await project_of(connection, principal, project_id)
    case_label = await connection.scalar(select(cases.c.label).where(cases.c.id == case_id))
    case_slides = (
        await connection.execute(
            select(slides.c.id, slides.c.label, slides.c.stain, slides.c.block_id)
            .where(slides.c.case_id == case_id, slides.c.deleted_at.is_(None))
            .order_by(*CASE_SLIDE_ORDER)
        )
    ).all()
    measured = [item for item in report.findings.measurements if item.length_mm is not None]
    return CosignReview(
        id=str(report.id),
        project=ProjectRef(id=project.id, code=project.code, name=project.name),
        case_label=str(case_label),
        template=CosignReviewTemplate(
            name=report.template.name, version=f"v{report.template.version}"
        ),
        from_user_id=report.sent_by_user_id,
        to_user_id=report.cosigner_user_id,
        sent_at=report.sent_at or (await report_row(connection, case_id)).updated_at,
        values=clinical_values(report.sent.values if report.sent else report),
        slides=[
            CosignReviewSlide(key=item.key, node=item.node, short=item.short)
            for item in slides_of(case_slides)
        ],
        ai=CosignAi(
            largest_mm=max((item.length_mm or 0.0 for item in measured), default=0.0),
            deposits=[
                CosignAiDeposit(
                    slide=str(item.slide_id),
                    object_id=item.object_id,
                    size_mm=item.length_mm or 0.0,
                )
                for item in measured
            ],
        ),
        co_signer_covers_case=report.cosigner_user_id in report.signers,
    )


async def sent_to_me(
    connection: AsyncConnection,
    principal: CurrentPrincipal,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> uuid.UUID:
    case_id = await case_of_slide(connection, project_id, slide_id)
    row = await writable(connection, principal, project_id, case_id)
    if CaseReportState(row.state) is not CaseReportState.SENT:
        raise WrongStateError
    if row.cosigner_user_id != user_id_of(principal):
        raise NotCosignerError
    return case_id


@router.post(
    "/cosign-request/return",
    operation_id="returnCosignRequest",
    **require(Permission.REVIEW, write=True),
)
async def return_cosign_request(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    body: CosignReturnRequest,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CosignReturn:
    case_id = await sent_to_me(connection, principal, project_id, slide_id)
    returned = await return_clinical_report(
        project_id=project_id,
        case_id=case_id,
        note=CaseReportReturn(note=body.note),
        principal=principal,
        connection=connection,
    )
    row = await report_row(connection, case_id)
    return CosignReturn(
        id=str(returned.id), note=returned.return_note or "", returned_at=row.updated_at
    )


@router.post(
    "/cosign-request/co-sign",
    operation_id="cosignClinicalReport",
    **require(Permission.REVIEW, write=True),
)
async def cosign_clinical_report(
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    body: CosignSignRequest,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ClinicalSignature:
    case_id = await sent_to_me(connection, principal, project_id, slide_id)
    signed = await sign_clinical_report(
        project_id=project_id,
        case_id=case_id,
        principal=principal,
        connection=connection,
        confirmation=CaseReportSignOut(confirmed_with=body.method),
    )
    last = signed.versions[-1]
    return ClinicalSignature(
        version=last.number,
        signed_by_user_id=last.signed_by_user_id,
        reported_by_user_id=last.reported_by_user_id,
        signed_at=last.signed_at,
    )
