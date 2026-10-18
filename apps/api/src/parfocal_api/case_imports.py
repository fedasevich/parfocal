import csv
import io
import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.case_creation import privacy_of, require_owner
from parfocal_api.cases import keyring_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.identifiers import (
    PatientIdentity,
    TenantKeys,
    add_patient,
    ensure_keys,
    find_patients,
    load_keys,
    normal_mrn,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal, database_scope
from parfocal_api.problems import BadRequestError
from parfocal_api.tables import CaseSource, PrivacyMode, Sex, cases, patients, slides
from parfocal_common.envelope import DataKeyUnavailableError
from parfocal_common.object_ids import LOOSE_CASE

MAX_ROWS = 5_000
MAX_BYTES = 2_000_000
COLUMNS = (
    "case",
    "slide",
    "barcode",
    "stain",
    "patient_name",
    "mrn",
    "birth_date",
    "sex",
    "age_years",
)
PATIENT_COLUMNS = ("patient_name", "mrn", "birth_date", "sex", "age_years")
LIMITS = {"case": 100, "slide": 200, "barcode": 100, "stain": 60, "patient_name": 200, "mrn": 40}


class CaseImport(BaseModel):
    csv: Annotated[str, Field(max_length=MAX_BYTES)]
    dry_run: bool = True


class RowProblem(BaseModel):
    row: int
    column: str | None
    message: str


class ImportReport(BaseModel):
    dry_run: bool
    imported: bool
    rows: int
    cases_created: int
    cases_existing: int
    patients_created: int
    slides_created: int
    slides_existing: int
    problems: list[RowProblem]


class NotACsvError(BadRequestError):
    code = "not-a-csv"
    title = "The file is not a CSV with a case column"


@dataclass
class PatientFields:
    name: str | None = None
    mrn: str | None = None
    birth_date: date | None = None
    sex: Sex = Sex.UNKNOWN
    age_years: int | None = None

    @property
    def given(self) -> bool:
        return (
            any(
                value is not None
                for value in (self.name, self.mrn, self.birth_date, self.age_years)
            )
            or self.sex is not Sex.UNKNOWN
        )


@dataclass
class SlideLine:
    row: int
    label: str
    barcode: str | None
    stain: str


@dataclass
class CaseLine:
    row: int
    label: str
    patient: PatientFields
    slides: list[SlideLine] = field(default_factory=list[SlideLine])


@dataclass
class Plan:
    cases: dict[str, CaseLine] = field(default_factory=dict[str, CaseLine])
    problems: list[RowProblem] = field(default_factory=list[RowProblem])
    rows: int = 0


router = APIRouter(prefix="/api/projects/{project_id}/case-imports", tags=["cases"])


def column_name(header: str) -> str:
    return header.strip().lower().replace(" ", "_").replace("-", "_")


def dialect_of(text: str) -> type[csv.Dialect] | csv.Dialect:
    try:
        return csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        return csv.excel


def cell(row: dict[str, str], name: str) -> str | None:
    value = (row.get(name) or "").strip()
    return value or None


def parse_patient(row: dict[str, str], line: int, plan: Plan) -> PatientFields:
    patient = PatientFields(name=cell(row, "patient_name"), mrn=cell(row, "mrn"))
    if (birth := cell(row, "birth_date")) is not None:
        try:
            patient.birth_date = date.fromisoformat(birth)
        except ValueError:
            plan.problems.append(
                RowProblem(row=line, column="birth_date", message="Use YYYY-MM-DD")
            )
    if (sex := cell(row, "sex")) is not None:
        try:
            patient.sex = Sex(sex.lower())
        except ValueError:
            allowed = ", ".join(item.value for item in Sex)
            plan.problems.append(
                RowProblem(row=line, column="sex", message=f"Use one of {allowed}")
            )
    if (age := cell(row, "age_years")) is not None:
        if age.isdigit() and int(age) <= 150:
            patient.age_years = int(age)
        else:
            plan.problems.append(
                RowProblem(row=line, column="age_years", message="Use a whole number up to 150")
            )
    if patient.given and patient.name is None:
        plan.problems.append(
            RowProblem(row=line, column="patient_name", message="A patient needs a name")
        )
    return patient


def parsed(text: str, mode: PrivacyMode) -> Plan:
    reader = csv.DictReader(io.StringIO(text), dialect=dialect_of(text))
    if reader.fieldnames is None:
        raise NotACsvError
    reader.fieldnames = [column_name(name) for name in reader.fieldnames]
    if "case" not in reader.fieldnames:
        raise NotACsvError
    plan = Plan()
    unknown = [name for name in reader.fieldnames if name not in COLUMNS]
    if unknown:
        plan.problems.append(
            RowProblem(row=1, column=None, message=f"Unknown columns: {', '.join(unknown)}")
        )
    for line, row in enumerate(reader, start=2):
        plan.rows += 1
        if plan.rows > MAX_ROWS:
            plan.problems.append(RowProblem(row=line, column=None, message="At most 5,000 rows"))
            break
        for name, limit in LIMITS.items():
            if len(cell(row, name) or "") > limit:
                plan.problems.append(
                    RowProblem(row=line, column=name, message=f"At most {limit} characters")
                )
        label = cell(row, "case")
        if label is None:
            plan.problems.append(RowProblem(row=line, column="case", message="The case is empty"))
            continue
        if label == LOOSE_CASE:
            plan.problems.append(
                RowProblem(row=line, column="case", message="~ cannot be a case label")
            )
            continue
        patient = parse_patient(row, line, plan)
        if patient.given and mode is PrivacyMode.DE_IDENTIFIED:
            plan.problems.append(
                RowProblem(
                    row=line,
                    column="patient_name",
                    message="This project is de-identified and takes no patient fields",
                )
            )
        known = plan.cases.get(label)
        if known is None:
            known = plan.cases[label] = CaseLine(row=line, label=label, patient=patient)
        elif patient.given and known.patient.given and patient != known.patient:
            plan.problems.append(
                RowProblem(
                    row=line,
                    column="patient_name",
                    message=f"The patient differs from row {known.row} for the same case",
                )
            )
        elif patient.given:
            known.patient = patient
        if (slide := cell(row, "slide")) is not None:
            if any(item.label == slide for item in known.slides):
                plan.problems.append(
                    RowProblem(row=line, column="slide", message="The slide appears twice")
                )
                continue
            known.slides.append(
                SlideLine(line, slide, cell(row, "barcode"), cell(row, "stain") or "H&E")
            )
    barcodes: dict[str, int] = {}
    for item in (s for case in plan.cases.values() for s in case.slides):
        if item.barcode is None:
            continue
        if item.barcode in barcodes:
            plan.problems.append(
                RowProblem(
                    row=item.row,
                    column="barcode",
                    message=f"The barcode is used on row {barcodes[item.barcode]}",
                )
            )
        barcodes[item.barcode] = item.row
    return plan


@dataclass
class Existing:
    cases: dict[str, Any]
    slides: set[tuple[uuid.UUID, str]]
    barcodes: dict[str, tuple[uuid.UUID | None, str]]


async def existing(connection: AsyncConnection, project_id: uuid.UUID, plan: Plan) -> Existing:
    found = {
        row.label: row
        for row in await connection.execute(
            select(cases.c.id, cases.c.label, cases.c.patient_id).where(
                cases.c.project_id == project_id,
                cases.c.deleted_at.is_(None),
                cases.c.label.in_(list(plan.cases)),
            )
        )
    }
    slide_rows = (
        await connection.execute(
            select(slides.c.case_id, slides.c.label, slides.c.barcode).where(
                slides.c.project_id == project_id, slides.c.deleted_at.is_(None)
            )
        )
    ).all()
    return Existing(
        cases=found,
        slides={(row.case_id, row.label) for row in slide_rows if row.case_id is not None},
        barcodes={row.barcode: (row.case_id, row.label) for row in slide_rows if row.barcode},
    )


async def check_against(
    connection: AsyncConnection,
    keys: TenantKeys | None,
    project_id: uuid.UUID,
    plan: Plan,
    now: Existing,
) -> None:
    for case in plan.cases.values():
        row = now.cases.get(case.label)
        if row is not None and case.patient.mrn and keys is not None:
            owners = await find_patients(connection, keys, project_id, mrn=case.patient.mrn)
            if row.patient_id is not None and row.patient_id not in owners:
                plan.problems.append(
                    RowProblem(
                        row=case.row,
                        column="mrn",
                        message="The case already belongs to another patient",
                    )
                )
        case_id = row.id if row is not None else None
        for item in case.slides:
            holder = now.barcodes.get(item.barcode) if item.barcode else None
            if holder is not None and holder != (case_id, item.label):
                plan.problems.append(
                    RowProblem(
                        row=item.row, column="barcode", message="Another slide has this barcode"
                    )
                )


async def patient_of(
    connection: AsyncConnection,
    keys: TenantKeys,
    project_id: uuid.UUID,
    patient: PatientFields,
    made: dict[str, uuid.UUID],
) -> tuple[uuid.UUID, bool]:
    if patient.mrn:
        mrn = normal_mrn(patient.mrn)
        if mrn in made:
            return made[mrn], False
        found = await find_patients(connection, keys, project_id, mrn=patient.mrn)
        if found:
            return found[0], False
    assert patient.name is not None
    patient_id = await add_patient(
        connection, keys, project_id, PatientIdentity(patient.name, patient.mrn, patient.birth_date)
    )
    await connection.execute(
        patients.update()
        .where(patients.c.id == patient_id)
        .values(sex=patient.sex, age_years=patient.age_years)
    )
    if patient.mrn:
        made[normal_mrn(patient.mrn)] = patient_id
    return patient_id, True


async def write(
    connection: AsyncConnection,
    principal: Principal,
    keys: TenantKeys | None,
    project_id: uuid.UUID,
    plan: Plan,
    now: Existing,
    report: ImportReport,
) -> None:
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    author = principal.user_id if isinstance(principal, MemberPrincipal) else None
    made: dict[str, uuid.UUID] = {}
    for case in plan.cases.values():
        row = now.cases.get(case.label)
        if row is not None:
            case_id = row.id
            report.cases_existing += 1
        else:
            patient_id = None
            if case.patient.given and keys is not None:
                patient_id, created = await patient_of(
                    connection, keys, project_id, case.patient, made
                )
                report.patients_created += created
            case_id = uuid.uuid4()
            await connection.execute(
                insert(cases).values(
                    id=case_id,
                    tenant_id=tenant_id,
                    project_id=project_id,
                    patient_id=patient_id,
                    label=case.label,
                    source=CaseSource.IMPORT,
                    created_by_user_id=author,
                )
            )
            await record(
                connection,
                actor_of(principal),
                AuditAction.CASE_CREATED,
                AuditTarget.CASE,
                case_id,
                tenant_id=tenant_id,
                details={"source": CaseSource.IMPORT, "new_patient": patient_id is not None},
            )
            report.cases_created += 1
        new_slides = [item for item in case.slides if (case_id, item.label) not in now.slides]
        report.slides_existing += len(case.slides) - len(new_slides)
        if new_slides:
            await connection.execute(
                insert(slides),
                [
                    {
                        "tenant_id": tenant_id,
                        "project_id": project_id,
                        "case_id": case_id,
                        "label": item.label,
                        "barcode": item.barcode,
                        "stain": item.stain,
                    }
                    for item in new_slides
                ],
            )
            report.slides_created += len(new_slides)


def counted(plan: Plan, now: Existing) -> ImportReport:
    report = ImportReport(
        dry_run=True,
        imported=False,
        rows=plan.rows,
        cases_created=0,
        cases_existing=0,
        patients_created=0,
        slides_created=0,
        slides_existing=0,
        problems=sorted(plan.problems, key=lambda p: (p.row, p.column or "")),
    )
    for case in plan.cases.values():
        row = now.cases.get(case.label)
        case_id = row.id if row is not None else None
        if row is None:
            report.cases_created += 1
            report.patients_created += int(case.patient.given)
        else:
            report.cases_existing += 1
        known = sum((case_id, item.label) in now.slides for item in case.slides)
        report.slides_existing += known
        report.slides_created += len(case.slides) - known
    return report


@router.post("", operation_id="importCases", **require(Permission.CREATE_CASES, write=True))
async def import_cases(
    project_id: uuid.UUID,
    upload: CaseImport,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ImportReport:
    mode = await privacy_of(connection, project_id)
    await require_owner(connection, principal, project_id)
    plan = parsed(upload.csv, mode)
    now = await existing(connection, project_id, plan)
    tenant_id = database_scope(principal).tenant_id
    assert tenant_id is not None
    keyring = keyring_of(request)
    with_patients = mode is PrivacyMode.CLINICAL and any(
        case.patient.given for case in plan.cases.values()
    )
    keys = None
    if with_patients and not upload.dry_run:
        keys = await ensure_keys(connection, keyring, tenant_id)
    elif with_patients:
        try:
            keys = await load_keys(connection, keyring, tenant_id)
        except DataKeyUnavailableError:
            keys = None
    await check_against(connection, keys, project_id, plan, now)
    report = counted(plan, now)
    if upload.dry_run or report.problems:
        report.dry_run = upload.dry_run
        return report
    final = ImportReport(
        dry_run=False,
        imported=True,
        rows=plan.rows,
        cases_created=0,
        cases_existing=0,
        patients_created=0,
        slides_created=0,
        slides_existing=0,
        problems=[],
    )
    await write(connection, principal, keys, project_id, plan, now, final)
    return final
