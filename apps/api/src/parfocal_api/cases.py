import uuid
from datetime import date, datetime
from typing import cast

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import literal, or_, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.case_access import require_case_access
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.identifiers import TenantKeys, load_keys, open_field, read_patient
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import GuestPrincipal, MemberPrincipal, Principal, database_scope
from parfocal_api.problems import NotFoundError
from parfocal_api.tables import (
    CaseSource,
    Laterality,
    Priority,
    Role,
    Sex,
    blocks,
    cases,
    patients,
    slides,
    specimens,
)
from parfocal_common.envelope import MasterKeyring


class PatientDetail(BaseModel):
    id: uuid.UUID
    name: str
    mrn: str | None
    birth_date: date | None
    sex: Sex
    age_years: int | None


class BlockDetail(BaseModel):
    id: uuid.UUID
    number: int
    description: str | None
    stains: list[str]
    levels: int


class SpecimenDetail(BaseModel):
    id: uuid.UUID
    letter: str
    type: str | None
    site: str | None
    laterality: Laterality
    procedure: str | None
    collected_at: datetime | None
    received_at: datetime | None
    blocks: list[BlockDetail]


class SlideDetail(BaseModel):
    id: uuid.UUID
    block_id: uuid.UUID | None
    barcode: str | None
    stain: str
    level: int | None


class CaseDetail(BaseModel):
    id: uuid.UUID
    accession: str
    priority: Priority
    due_at: datetime | None
    source: CaseSource
    assignee_user_id: uuid.UUID | None
    service: str | None
    requester: str | None
    is_draft: bool
    clinical_note: str | None
    clinical_question: str | None
    patient: PatientDetail | None
    specimens: list[SpecimenDetail]
    slides: list[SlideDetail]


router = APIRouter(prefix="/api/cases", tags=["cases"])


def keyring_of(request: Request) -> MasterKeyring:
    return cast("MasterKeyring", request.app.keyring)


async def patient_detail(
    connection: AsyncConnection, keys: TenantKeys, patient_id: uuid.UUID
) -> PatientDetail:
    identity = await read_patient(connection, keys, patient_id)
    row = (
        await connection.execute(
            select(patients.c.sex, patients.c.age_years).where(patients.c.id == patient_id)
        )
    ).one()
    return PatientDetail(
        id=patient_id,
        name=identity.name,
        mrn=identity.mrn,
        birth_date=identity.birth_date,
        sex=Sex(row.sex),
        age_years=row.age_years,
    )


async def specimen_details(connection: AsyncConnection, case_id: uuid.UUID) -> list[SpecimenDetail]:
    specimen_rows = (
        await connection.execute(
            select(specimens)
            .where(specimens.c.case_id == case_id, specimens.c.deleted_at.is_(None))
            .order_by(specimens.c.letter)
        )
    ).all()
    block_rows = (
        await connection.execute(
            select(blocks)
            .where(blocks.c.case_id == case_id, blocks.c.deleted_at.is_(None))
            .order_by(blocks.c.number)
        )
    ).all()
    return [
        SpecimenDetail(
            id=specimen.id,
            letter=specimen.letter,
            type=specimen.type,
            site=specimen.site,
            laterality=Laterality(specimen.laterality),
            procedure=specimen.procedure,
            collected_at=specimen.collected_at,
            received_at=specimen.received_at,
            blocks=[
                BlockDetail(
                    id=block.id,
                    number=block.number,
                    description=block.description,
                    stains=list(block.stains),
                    levels=block.levels,
                )
                for block in block_rows
                if block.specimen_id == specimen.id
            ],
        )
        for specimen in specimen_rows
    ]


def sees_draft(principal: Principal, created_by: uuid.UUID | None) -> bool:
    if not isinstance(principal, MemberPrincipal):
        return False
    return principal.role is Role.LAB or principal.user_id == created_by


@router.get("/{case_id}", operation_id="getCase", **require(Permission.SEE_CASES, emergency=True))
async def get_case(
    case_id: uuid.UUID,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseDetail:
    return await case_detail(connection, keyring_of(request), principal, case_id)


async def case_detail(
    connection: AsyncConnection,
    keyring: MasterKeyring,
    principal: Principal,
    case_id: uuid.UUID,
) -> CaseDetail:
    row = (
        await connection.execute(
            select(cases).where(cases.c.id == case_id, cases.c.deleted_at.is_(None))
        )
    ).one_or_none()
    if row is None or (row.is_draft and not sees_draft(principal, row.created_by_user_id)):
        raise NotFoundError("Case not found")
    await require_case_access(connection, principal, case_id, Permission.SEE_CASES)
    slide_rows = (
        await connection.execute(
            select(slides)
            .where(slides.c.case_id == case_id, slides.c.deleted_at.is_(None))
            .order_by(slides.c.created_at)
        )
    ).all()
    guest = isinstance(principal, GuestPrincipal)
    patient = note = question = None
    if not guest:
        tenant_id = database_scope(principal).tenant_id
        assert tenant_id is not None
        keys = await load_keys(connection, keyring, tenant_id)
        patient = await patient_detail(connection, keys, row.patient_id)
        note = open_field(keys, "cases", case_id, "clinical_note", row.clinical_note)
        question = open_field(keys, "cases", case_id, "clinical_question", row.clinical_question)
    return CaseDetail(
        id=row.id,
        accession=row.accession,
        priority=Priority(row.priority),
        due_at=row.due_at,
        source=CaseSource(row.source),
        assignee_user_id=row.assignee_user_id,
        service=row.service,
        requester=row.requester,
        is_draft=row.is_draft,
        clinical_note=note,
        clinical_question=question,
        patient=patient,
        specimens=await specimen_details(connection, case_id),
        slides=[
            SlideDetail(
                id=slide.id,
                block_id=slide.block_id,
                barcode=slide.barcode,
                stain=slide.stain,
                level=slide.level,
            )
            for slide in slide_rows
        ],
    )


class CaseSummary(BaseModel):
    id: uuid.UUID
    accession: str
    priority: Priority
    due_at: datetime | None
    assignee_user_id: uuid.UUID | None


@router.get("", operation_id="listCases", **require(Permission.SEE_CASES))
async def list_cases(
    principal: CurrentPrincipal, connection: TenantConnection
) -> list[CaseSummary]:
    statement = select(cases).where(cases.c.deleted_at.is_(None))
    if isinstance(principal, MemberPrincipal):
        statement = statement.where(
            or_(
                cases.c.is_draft.is_(False),
                cases.c.created_by_user_id == principal.user_id,
                literal(principal.role is Role.LAB),
            )
        )
    else:
        statement = statement.where(cases.c.is_draft.is_(False))
    rows = await connection.execute(statement.order_by(cases.c.created_at))
    return [CaseSummary.model_validate(row, from_attributes=True) for row in rows]
