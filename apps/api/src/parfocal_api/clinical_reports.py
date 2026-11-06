import re
import uuid
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.clinical_report_pdf import facts_of, pdf_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.evaluation_versions import ConfirmedWith
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import role_in
from parfocal_api.projects import ProjectArchivedError, visible
from parfocal_api.sign_out import signs_out_case
from parfocal_api.slide_areas import MICRONS_PER_MM
from parfocal_api.tables import (
    AnnotationKind,
    CaseReportState,
    ClinicalTemplate,
    Extranodal,
    NodeCategory,
    PrivacyMode,
    ProjectRole,
    VerdictValue,
    annotations,
    cases,
    clinical_deposits,
    clinical_report_versions,
    clinical_reports,
    project_members,
    slides,
    users,
    verdicts,
)
from parfocal_common.node_staging import STAGES, Category, category_of
from parfocal_common.object_ids import Letter, ObjectId, ObjectIdError, parse


class CaseReportStep(StrEnum):
    FINDINGS = "findings"
    STAGING = "staging"
    TEXT = "text"
    SIGN = "sign"


@dataclass(frozen=True)
class TemplateSpec:
    name: str
    version: int
    steps: tuple[CaseReportStep, ...]


TEMPLATES = {
    ClinicalTemplate.SENTINEL_NODE: TemplateSpec(
        "Sentinel node report",
        1,
        (CaseReportStep.FINDINGS, CaseReportStep.STAGING, CaseReportStep.TEXT, CaseReportStep.SIGN),
    ),
    ClinicalTemplate.LYMPH_NODE_EXCISION: TemplateSpec(
        "Lymph node excision report",
        1,
        (CaseReportStep.FINDINGS, CaseReportStep.TEXT, CaseReportStep.SIGN),
    ),
}

EDITABLE = {CaseReportState.DRAFT, CaseReportState.RETURNED}
SIGNED = {CaseReportState.SIGNED, CaseReportState.AMENDED}
WRITERS = {ProjectRole.OWNER, ProjectRole.REVIEWER}
TEXT_FIELDS = ("specimen", "diagnosis", "microscopic", "comment")
STAGING_FIELDS = ("category", "nodes_examined", "extranodal")
REQUIRED_TEXT = ("specimen", "diagnosis")

Reason = Annotated[str, Field(min_length=10, max_length=300)]


class CaseReportBlockerCode(StrEnum):
    REQUIRED_FIELD_EMPTY = "required-field-empty"
    DEPOSIT_WITHOUT_SIZE = "deposit-without-size"
    CATEGORY_NOT_CONFIRMED = "category-not-confirmed"


class CaseReportBlocker(BaseModel):
    code: CaseReportBlockerCode
    field: str | None = None
    deposit_id: uuid.UUID | None = None


class CaseReportTemplate(BaseModel):
    key: ClinicalTemplate
    name: str
    version: int
    steps: list[CaseReportStep]


class CaseReportDeposit(BaseModel):
    id: uuid.UUID
    slide_id: uuid.UUID
    object_id: str | None
    size_mm: float | None
    note: str | None
    largest: bool


class CaseReportStaging(BaseModel):
    largest_mm: float | None
    suggested_category: NodeCategory
    suggested_pn: str
    nodes_positive: int
    contradicts: bool
    confirmed: bool


class CaseReportDecision(BaseModel):
    slide_id: uuid.UUID
    object_id: str
    decision: VerdictValue


class CaseReportMeasurement(BaseModel):
    slide_id: uuid.UUID
    object_id: str
    length_mm: float | None


class CaseReportFindings(BaseModel):
    decisions: list[CaseReportDecision]
    measurements: list[CaseReportMeasurement]


class CaseReportSignature(BaseModel):
    number: int
    signed_by_user_id: uuid.UUID | None
    reported_by_user_id: uuid.UUID | None
    signed_at: datetime
    reason: str | None


class CaseReportValues(BaseModel):
    specimen: str | None
    category: NodeCategory | None
    nodes_examined: int | None
    extranodal: Extranodal | None
    diagnosis: str | None
    microscopic: str | None
    comment: str | None
    deposits: list[CaseReportDeposit]


class CaseReport(CaseReportValues):
    id: uuid.UUID
    project_id: uuid.UUID
    case_id: uuid.UUID
    state: CaseReportState
    template: CaseReportTemplate
    staging: CaseReportStaging | None
    findings: CaseReportFindings
    blockers: list[CaseReportBlocker]
    cosigner_user_id: uuid.UUID | None
    sent_by_user_id: uuid.UUID | None
    return_note: str | None
    version: int
    versions: list[CaseReportSignature]


class CaseReportVersion(CaseReportSignature):
    values: CaseReportValues
    staging: CaseReportStaging | None


class CaseReportChange(BaseModel):
    specimen: str | None = Field(default=None, max_length=200)
    category: NodeCategory | None = None
    confirm_category: bool = False
    nodes_examined: int | None = Field(default=None, ge=0, le=999)
    extranodal: Extranodal | None = None
    diagnosis: str | None = Field(default=None, max_length=2000)
    microscopic: str | None = Field(default=None, max_length=5000)
    comment: str | None = Field(default=None, max_length=2000)


class NewCaseReportDeposit(BaseModel):
    slide_id: uuid.UUID
    object_id: str | None = Field(default=None, max_length=40)
    size_mm: float | None = Field(default=None, gt=0, le=1000)
    note: str | None = Field(default=None, max_length=300)

    @field_validator("object_id")
    @classmethod
    def known_object(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return parse(value).text(ascii=True)
        except ObjectIdError as error:
            raise ValueError(str(error)) from error


class CaseReportCosign(BaseModel):
    cosigner_user_id: uuid.UUID


class CaseReportSignOut(BaseModel):
    confirmed_with: ConfirmedWith = "sso"
    identity_answered: bool = True


class CaseReportReturn(BaseModel):
    note: Reason


class CaseReportAmendment(BaseModel):
    reason: Reason
    change: CaseReportChange


class ClinicalOnlyError(ConflictError):
    code = "no-clinical-report"
    title = "A de-identified project has no clinical report"


class ReportExistsError(ConflictError):
    code = "clinical-report-exists"
    title = "This case already has a clinical report"


class WrongStateError(ConflictError):
    code = "clinical-report-state"
    title = "The clinical report is not in a state that allows this"


class NoStagingError(ConflictError):
    code = "no-staging"
    title = "This clinical report template has no staging step"


class BlockedError(ConflictError):
    code = "clinical-report-blocked"
    title = "Clear the blockers before sending or signing the report"


class SizeNeededError(ConflictError):
    code = "deposit-size-needed"
    title = "A deposit measured by hand needs its size"


class CannotSignOutError(ForbiddenError):
    code = "cannot-sign-out"
    title = "Your Can sign out right does not cover this case"


class SingleSignOnSilentError(ConflictError):
    code = "single-sign-on-did-not-answer"
    title = "Single sign-on did not answer, so nothing was signed"


class NotCosignerError(ForbiddenError):
    code = "not-the-co-signer"
    title = "Only the named co-signer can act on a report sent for co-sign"


class CosignerNotCoveringError(ConflictError):
    code = "co-signer-not-covering"
    title = "The co-signer's Can sign out right does not cover this case"


router = APIRouter(
    prefix="/api/projects/{project_id}/cases/{case_id}/clinical-report",
    tags=["clinical-reports"],
)


async def clinical_case(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, case_id: uuid.UUID
) -> Any:
    project = await visible(connection, principal, project_id)
    found = await connection.scalar(
        select(cases.c.id).where(
            cases.c.id == case_id, cases.c.project_id == project_id, cases.c.deleted_at.is_(None)
        )
    )
    if found is None:
        raise NotFoundError("Case not found")
    if PrivacyMode(project.privacy_mode) is not PrivacyMode.CLINICAL:
        raise ClinicalOnlyError
    return project


async def report_row(connection: AsyncConnection, case_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(
            select(clinical_reports).where(clinical_reports.c.case_id == case_id)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Clinical report not found")
    return row


async def writable(
    connection: AsyncConnection, principal: Principal, project_id: uuid.UUID, case_id: uuid.UUID
) -> Any:
    project = await clinical_case(connection, principal, project_id, case_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    if await role_in(connection, principal, project_id) not in WRITERS:
        raise ForbiddenError
    return await report_row(connection, case_id)


def user_id_of(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


def require_editing(row: Any, principal: Principal) -> None:
    state = CaseReportState(row.state)
    if state in EDITABLE:
        return
    if state is CaseReportState.SENT and row.cosigner_user_id == user_id_of(principal):
        return
    raise WrongStateError


async def deposit_rows(connection: AsyncConnection, report_id: uuid.UUID) -> list[Any]:
    node = func.coalesce(slides.c.block_id, slides.c.id).label("node")
    return list(
        (
            await connection.execute(
                select(clinical_deposits, node)
                .join(slides, slides.c.id == clinical_deposits.c.slide_id)
                .where(clinical_deposits.c.report_id == report_id)
                .order_by(clinical_deposits.c.created_at, clinical_deposits.c.id)
            )
        ).all()
    )


def largest_of(rows: list[Any]) -> Any:
    sized = [row for row in rows if row.size_mm is not None]
    return max(sized, key=lambda row: row.size_mm, default=None)


def staging_of(row: Any, rows: list[Any]) -> CaseReportStaging | None:
    if CaseReportStep.STAGING not in TEMPLATES[ClinicalTemplate(row.template)].steps:
        return None
    largest = largest_of(rows)
    suggested = (
        NodeCategory(category_of(largest.size_mm)) if largest is not None else NodeCategory.NONE
    )
    contradicts = row.category is not None and row.category != suggested
    shown = Category(row.category or suggested)
    return CaseReportStaging(
        largest_mm=largest.size_mm if largest is not None else None,
        suggested_category=suggested,
        suggested_pn=STAGES[shown],
        nodes_positive=len({deposit.node for deposit in rows}),
        contradicts=contradicts,
        confirmed=not contradicts or row.confirmed_against == suggested,
    )


def blockers_of(
    row: Any, rows: list[Any], staging: CaseReportStaging | None
) -> list[CaseReportBlocker]:
    empty = [name for name in REQUIRED_TEXT if not (getattr(row, name) or "").strip()]
    if staging is not None:
        empty += [name for name in STAGING_FIELDS if getattr(row, name) is None]
    found = [
        CaseReportBlocker(code=CaseReportBlockerCode.REQUIRED_FIELD_EMPTY, field=name)
        for name in empty
    ]
    if staging is None:
        return found
    found += [
        CaseReportBlocker(code=CaseReportBlockerCode.DEPOSIT_WITHOUT_SIZE, deposit_id=deposit.id)
        for deposit in rows
        if deposit.size_mm is None
    ]
    if not staging.confirmed:
        found.append(
            CaseReportBlocker(code=CaseReportBlockerCode.CATEGORY_NOT_CONFIRMED, field="category")
        )
    return found


def values_of(row: Any, rows: list[Any]) -> CaseReportValues:
    largest = largest_of(rows)
    return CaseReportValues(
        specimen=row.specimen,
        category=row.category,
        nodes_examined=row.nodes_examined,
        extranodal=row.extranodal,
        diagnosis=row.diagnosis,
        microscopic=row.microscopic,
        comment=row.comment,
        deposits=[
            CaseReportDeposit(
                id=deposit.id,
                slide_id=deposit.slide_id,
                object_id=deposit.object_id,
                size_mm=deposit.size_mm,
                note=deposit.note,
                largest=largest is not None and deposit.id == largest.id,
            )
            for deposit in rows
        ],
    )


async def findings_of(connection: AsyncConnection, case_id: uuid.UUID) -> CaseReportFindings:
    case_slides = select(slides.c.id).where(
        slides.c.case_id == case_id, slides.c.deleted_at.is_(None)
    )
    decided = await connection.execute(
        select(verdicts.c.slide_id, verdicts.c.kind, verdicts.c.number, verdicts.c.value)
        .where(verdicts.c.slide_id.in_(case_slides))
        .order_by(verdicts.c.slide_id, verdicts.c.kind, verdicts.c.number, verdicts.c.user_id)
    )
    letters = {"region": Letter.REGION, "cell": Letter.CELL}
    length = func.ST_Length(annotations.c.geometry) * slides.c.mpp_x / MICRONS_PER_MM
    measured = await connection.execute(
        select(annotations.c.slide_id, annotations.c.number, length.label("length_mm"))
        .join(slides, slides.c.id == annotations.c.slide_id)
        .where(
            annotations.c.slide_id.in_(case_slides),
            annotations.c.kind == AnnotationKind.MEASUREMENT,
            annotations.c.deleted_at.is_(None),
        )
        .order_by(annotations.c.slide_id, annotations.c.number)
    )
    return CaseReportFindings(
        decisions=[
            CaseReportDecision(
                slide_id=row.slide_id,
                object_id=ObjectId(letters[row.kind], row.number).text(ascii=True),
                decision=row.value,
            )
            for row in decided
        ],
        measurements=[
            CaseReportMeasurement(
                slide_id=row.slide_id,
                object_id=ObjectId(Letter.MEASUREMENT, row.number).text(ascii=True),
                length_mm=round(row.length_mm, 4) if row.length_mm is not None else None,
            )
            for row in measured
        ],
    )


async def version_rows(
    connection: AsyncConnection, report_id: uuid.UUID
) -> list[CaseReportSignature]:
    rows = await connection.execute(
        select(clinical_report_versions)
        .where(clinical_report_versions.c.report_id == report_id)
        .order_by(clinical_report_versions.c.number)
    )
    return [CaseReportSignature.model_validate(row, from_attributes=True) for row in rows]


async def report_of(connection: AsyncConnection, case_id: uuid.UUID) -> CaseReport:
    row = await report_row(connection, case_id)
    rows = await deposit_rows(connection, row.id)
    spec = TEMPLATES[ClinicalTemplate(row.template)]
    staging = staging_of(row, rows)
    return CaseReport(
        **values_of(row, rows).model_dump(),
        id=row.id,
        project_id=row.project_id,
        case_id=row.case_id,
        state=row.state,
        template=CaseReportTemplate(
            key=row.template, name=spec.name, version=row.template_version, steps=list(spec.steps)
        ),
        staging=staging,
        findings=await findings_of(connection, case_id),
        blockers=blockers_of(row, rows, staging),
        cosigner_user_id=row.cosigner_user_id,
        sent_by_user_id=row.sent_by_user_id,
        return_note=row.return_note,
        version=row.version,
        versions=await version_rows(connection, row.id),
    )


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    row: Any,
    **details: Any,
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.CLINICAL_REPORT,
        row.id,
        tenant_id=row.tenant_id,
        details={"project_id": str(row.project_id), "case_id": str(row.case_id), **details},
    )


async def apply_change(
    connection: AsyncConnection, row: Any, change: CaseReportChange
) -> list[str]:
    fields = change.model_fields_set - {"confirm_category"}
    staged = CaseReportStep.STAGING in TEMPLATES[ClinicalTemplate(row.template)].steps
    if not staged and fields & set(STAGING_FIELDS):
        raise NoStagingError
    values: dict[str, Any] = {name: getattr(change, name) for name in fields}
    for name in TEXT_FIELDS:
        if name in values and values[name] is not None:
            values[name] = values[name].strip() or None
    if "category" in values and values["category"] != row.category:
        values["confirmed_against"] = None
    if change.confirm_category:
        if not staged:
            raise NoStagingError
        current = replace_row(row, values)
        staging = staging_of(current, await deposit_rows(connection, row.id))
        assert staging is not None
        values["confirmed_against"] = staging.suggested_category
    changed = sorted(name for name in values if values[name] != getattr(row, name))
    if changed:
        await connection.execute(
            update(clinical_reports)
            .where(clinical_reports.c.id == row.id)
            .values(**{name: values[name] for name in changed}, updated_at=func.now())
        )
    return [name for name in changed if name != "confirmed_against"] + (
        ["category-confirmed"]
        if "confirmed_against" in changed and values["confirmed_against"]
        else []
    )


@dataclass(frozen=True)
class RowView:
    template: str
    category: str | None
    confirmed_against: str | None


def replace_row(row: Any, values: dict[str, Any]) -> RowView:
    return RowView(
        template=row.template,
        category=values.get("category", row.category),
        confirmed_against=values.get("confirmed_against", row.confirmed_against),
    )


async def require_unblocked(connection: AsyncConnection, case_id: uuid.UUID) -> CaseReport:
    report = await report_of(connection, case_id)
    if report.blockers:
        raise BlockedError
    return report


async def snapshot(
    connection: AsyncConnection, case_id: uuid.UUID, confirmed_with: str | None = None
) -> dict[str, Any]:
    report = await report_of(connection, case_id)
    return {
        "confirmed_with": confirmed_with,
        "values": CaseReportValues.model_validate(report.model_dump()).model_dump(mode="json"),
        "staging": report.staging.model_dump(mode="json") if report.staging else None,
    }


async def sign_version(
    connection: AsyncConnection,
    row: Any,
    principal: Principal,
    state: CaseReportState,
    reason: str | None = None,
    reported_by: uuid.UUID | None = None,
    confirmed_with: str | None = None,
) -> None:
    number = row.version + 1
    await connection.execute(
        insert(clinical_report_versions).values(
            tenant_id=row.tenant_id,
            report_id=row.id,
            number=number,
            content=await snapshot(connection, row.case_id, confirmed_with),
            reason=reason,
            signed_by_user_id=user_id_of(principal),
            reported_by_user_id=reported_by,
        )
    )
    await connection.execute(
        update(clinical_reports)
        .where(clinical_reports.c.id == row.id)
        .values(state=state, version=number, updated_at=func.now())
    )


@router.post(
    "",
    operation_id="createCaseReport",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def create_clinical_report(
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseReport:
    project = await clinical_case(connection, principal, project_id, case_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    if await role_in(connection, principal, project_id) not in WRITERS:
        raise ForbiddenError
    template = ClinicalTemplate(project.clinical_template)
    exists = select(clinical_reports.c.id).where(clinical_reports.c.case_id == case_id).exists()
    if await connection.scalar(select(exists)):
        raise ReportExistsError
    row = (
        await connection.execute(
            insert(clinical_reports)
            .values(
                tenant_id=project.tenant_id,
                project_id=project_id,
                case_id=case_id,
                template=template,
                template_version=TEMPLATES[template].version,
                state=CaseReportState.DRAFT,
                created_by_user_id=user_id_of(principal),
            )
            .returning(clinical_reports)
        )
    ).one()
    await audit(
        connection,
        principal,
        AuditAction.CLINICAL_REPORT_CREATED,
        row,
        template=template.value,
        template_version=TEMPLATES[template].version,
    )
    return await report_of(connection, case_id)


@router.get(
    "",
    operation_id="getCaseReport",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_clinical_report(
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseReport:
    await clinical_case(connection, principal, project_id, case_id)
    return await report_of(connection, case_id)


@router.get(
    "/versions/{number}",
    operation_id="getCaseReportVersion",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_clinical_report_version(
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    number: int,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseReportVersion:
    await clinical_case(connection, principal, project_id, case_id)
    row = await report_row(connection, case_id)
    version = (
        await connection.execute(
            select(clinical_report_versions).where(
                clinical_report_versions.c.report_id == row.id,
                clinical_report_versions.c.number == number,
            )
        )
    ).one_or_none()
    if version is None:
        raise NotFoundError("Report version not found")
    summary = CaseReportSignature.model_validate(version, from_attributes=True)
    return CaseReportVersion(
        **summary.model_dump(),
        values=CaseReportValues.model_validate(version.content["values"]),
        staging=CaseReportStaging.model_validate(version.content["staging"])
        if version.content["staging"]
        else None,
    )


@router.patch(
    "",
    operation_id="updateCaseReport",
    **require(Permission.REVIEW, write=True),
)
async def update_clinical_report(
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    change: CaseReportChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseReport:
    row = await writable(connection, principal, project_id, case_id)
    require_editing(row, principal)
    changed = await apply_change(connection, row, change)
    if changed:
        await audit(connection, principal, AuditAction.CLINICAL_REPORT_CHANGED, row, fields=changed)
    return await report_of(connection, case_id)


async def measured_length(
    connection: AsyncConnection, slide_id: uuid.UUID, object_id: str
) -> float | None:
    parsed = parse(object_id)
    if parsed.letter is not Letter.MEASUREMENT:
        return None
    length = func.ST_Length(annotations.c.geometry) * slides.c.mpp_x / MICRONS_PER_MM
    found = (
        await connection.execute(
            select(length.label("length_mm"))
            .join(slides, slides.c.id == annotations.c.slide_id)
            .where(
                annotations.c.slide_id == slide_id,
                annotations.c.kind == AnnotationKind.MEASUREMENT,
                annotations.c.number == parsed.number,
                annotations.c.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if found is None:
        raise NotFoundError("Measurement not found on this slide")
    return round(found.length_mm, 4) if found.length_mm else None


@router.post(
    "/deposits",
    operation_id="addCaseReportDeposit",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def add_clinical_deposit(
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    deposit: NewCaseReportDeposit,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseReport:
    row = await writable(connection, principal, project_id, case_id)
    require_editing(row, principal)
    if CaseReportStep.STAGING not in TEMPLATES[ClinicalTemplate(row.template)].steps:
        raise NoStagingError
    on_case = await connection.scalar(
        select(slides.c.id).where(
            slides.c.id == deposit.slide_id,
            slides.c.case_id == case_id,
            slides.c.deleted_at.is_(None),
        )
    )
    if on_case is None:
        raise NotFoundError("Slide not found in this case")
    size = deposit.size_mm
    if deposit.object_id is None and size is None:
        raise SizeNeededError
    if deposit.object_id is not None and size is None:
        size = await measured_length(connection, deposit.slide_id, deposit.object_id)
    note = (deposit.note or "").strip() or None
    added = await connection.scalar(
        insert(clinical_deposits)
        .values(
            tenant_id=row.tenant_id,
            report_id=row.id,
            slide_id=deposit.slide_id,
            object_id=deposit.object_id,
            size_mm=size,
            note=note,
        )
        .returning(clinical_deposits.c.id)
    )
    await audit(
        connection,
        principal,
        AuditAction.CLINICAL_DEPOSIT_ADDED,
        row,
        deposit_id=str(added),
        slide_id=str(deposit.slide_id),
        source="object" if deposit.object_id else "hand",
    )
    return await report_of(connection, case_id)


@router.delete(
    "/deposits/{deposit_id}",
    operation_id="removeCaseReportDeposit",
    **require(Permission.REVIEW, write=True),
)
async def remove_clinical_deposit(
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    deposit_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseReport:
    row = await writable(connection, principal, project_id, case_id)
    require_editing(row, principal)
    removed = await connection.scalar(
        delete(clinical_deposits)
        .where(clinical_deposits.c.id == deposit_id, clinical_deposits.c.report_id == row.id)
        .returning(clinical_deposits.c.id)
    )
    if removed is None:
        raise NotFoundError("CaseReportDeposit not found")
    await audit(
        connection, principal, AuditAction.CLINICAL_DEPOSIT_REMOVED, row, deposit_id=str(removed)
    )
    return await report_of(connection, case_id)


@router.post(
    "/send",
    operation_id="sendCaseReportForCosign",
    **require(Permission.REVIEW, write=True),
)
async def send_clinical_report(
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    request: CaseReportCosign,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseReport:
    row = await writable(connection, principal, project_id, case_id)
    if CaseReportState(row.state) not in EDITABLE:
        raise WrongStateError
    await require_unblocked(connection, case_id)
    assert isinstance(principal, MemberPrincipal)
    member = await connection.scalar(
        select(project_members.c.user_id).where(
            project_members.c.project_id == project_id,
            project_members.c.user_id == request.cosigner_user_id,
        )
    )
    cosigner = replace(principal, user_id=request.cosigner_user_id)
    if (
        member is None
        or request.cosigner_user_id == principal.user_id
        or not await signs_out_case(connection, cosigner, case_id)
    ):
        raise CosignerNotCoveringError
    await connection.execute(
        update(clinical_reports)
        .where(clinical_reports.c.id == row.id)
        .values(
            state=CaseReportState.SENT,
            cosigner_user_id=request.cosigner_user_id,
            sent_by_user_id=principal.user_id,
            return_note=None,
            updated_at=func.now(),
        )
    )
    await audit(
        connection,
        principal,
        AuditAction.CLINICAL_REPORT_SENT,
        row,
        cosigner_user_id=str(request.cosigner_user_id),
    )
    return await report_of(connection, case_id)


@router.post(
    "/return",
    operation_id="returnCaseReport",
    **require(Permission.REVIEW, write=True),
)
async def return_clinical_report(
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    note: CaseReportReturn,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseReport:
    row = await writable(connection, principal, project_id, case_id)
    if CaseReportState(row.state) is not CaseReportState.SENT:
        raise WrongStateError
    if row.cosigner_user_id != user_id_of(principal):
        raise NotCosignerError
    await connection.execute(
        update(clinical_reports)
        .where(clinical_reports.c.id == row.id)
        .values(
            state=CaseReportState.RETURNED, return_note=note.note.strip(), updated_at=func.now()
        )
    )
    await audit(connection, principal, AuditAction.CLINICAL_REPORT_RETURNED, row)
    return await report_of(connection, case_id)


@router.post(
    "/sign",
    operation_id="signCaseReport",
    **require(Permission.REVIEW, write=True),
)
async def sign_clinical_report(
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    confirmation: CaseReportSignOut | None = None,
) -> CaseReport:
    confirmation = confirmation or CaseReportSignOut()
    row = await writable(connection, principal, project_id, case_id)
    state = CaseReportState(row.state)
    if state in SIGNED:
        raise WrongStateError
    if state is CaseReportState.SENT and row.cosigner_user_id != user_id_of(principal):
        raise NotCosignerError
    if not await signs_out_case(connection, principal, case_id):
        raise CannotSignOutError
    await require_unblocked(connection, case_id)
    if confirmation.confirmed_with == "sso" and not confirmation.identity_answered:
        raise SingleSignOnSilentError
    reported_by = row.sent_by_user_id if state is CaseReportState.SENT else None
    await sign_version(
        connection,
        row,
        principal,
        CaseReportState.SIGNED,
        reported_by=reported_by,
        confirmed_with=confirmation.confirmed_with,
    )
    await audit(
        connection,
        principal,
        AuditAction.CLINICAL_REPORT_SIGNED,
        row,
        version=row.version + 1,
        co_signed=reported_by is not None,
        confirmed_with=confirmation.confirmed_with,
    )
    return await report_of(connection, case_id)


@router.post(
    "/amendments",
    operation_id="amendCaseReport",
    **require(Permission.REVIEW, write=True),
)
async def amend_clinical_report(
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    amendment: CaseReportAmendment,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseReport:
    row = await writable(connection, principal, project_id, case_id)
    if CaseReportState(row.state) not in SIGNED:
        raise WrongStateError
    if not await signs_out_case(connection, principal, case_id):
        raise CannotSignOutError
    changed = await apply_change(connection, row, amendment.change)
    await require_unblocked(connection, case_id)
    await sign_version(
        connection, row, principal, CaseReportState.AMENDED, reason=amendment.reason.strip()
    )
    await audit(
        connection,
        principal,
        AuditAction.CLINICAL_REPORT_AMENDED,
        row,
        version=row.version + 1,
        fields=changed,
    )
    return await report_of(connection, case_id)


def safe_name(label: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", label)


@router.get(
    "/versions/{number}/pdf",
    operation_id="downloadCaseReportPdf",
    response_class=Response,
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def download_clinical_report_pdf(
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    number: int,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Response:
    await clinical_case(connection, principal, project_id, case_id)
    row = await report_row(connection, case_id)
    version = (
        await connection.execute(
            select(clinical_report_versions).where(
                clinical_report_versions.c.report_id == row.id,
                clinical_report_versions.c.number == number,
            )
        )
    ).one_or_none()
    if version is None:
        raise NotFoundError("Report version not found")
    names = dict(
        (
            await connection.execute(
                select(users.c.id, users.c.display_name).where(
                    users.c.id.in_(
                        [
                            user
                            for user in (version.signed_by_user_id, version.reported_by_user_id)
                            if user is not None
                        ]
                    )
                )
            )
        ).all()
    )
    label = str(await connection.scalar(select(cases.c.label).where(cases.c.id == case_id)))
    facts = facts_of(
        label,
        TEMPLATES[ClinicalTemplate(row.template)].name,
        number,
        version.content,
        names.get(version.signed_by_user_id, "an unknown member"),
        version.signed_at,
        names.get(version.reported_by_user_id),
        version.reason,
    )
    return Response(
        pdf_of(facts, version.signed_at),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name(label)}_report_v{number}.pdf"'
        },
    )
