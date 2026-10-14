import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Annotated, Protocol

from fastapi import APIRouter, Header, Request, Response
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import exists, func, insert, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.accessions import (
    allocate_accession,
    check_imported_accession,
    current_year,
    format_of,
)
from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.cases import CaseDetail, case_detail, keyring_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.identifiers import (
    PatientIdentity,
    TenantKeys,
    add_patient,
    ensure_keys,
    find_patients,
    seal_field,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.tables import (
    CaseSource,
    Laterality,
    Priority,
    Sex,
    blocks,
    case_requests,
    cases,
    memberships,
    patients,
    specimens,
)

type Text200 = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
type Stain = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
type Letter = Annotated[str, StringConstraints(pattern=r"^[A-Z]{1,2}$")]


class NewPatient(BaseModel):
    name: Text200
    mrn: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)] | None
    ) = None
    birth_date: date | None = None
    sex: Sex = Sex.UNKNOWN
    age_years: Annotated[int, Field(ge=0, le=150)] | None = None


class BlockDraft(BaseModel):
    number: Annotated[int, Field(ge=1, le=999)]
    description: Text200 | None = None
    stains: Annotated[list[Stain], Field(max_length=20)] = ["H&E"]
    levels: Annotated[int, Field(ge=1, le=50)] = 1


class SpecimenDraft(BaseModel):
    letter: Letter
    type: Text200 | None = None
    site: Text200 | None = None
    laterality: Laterality = Laterality.UNKNOWN
    procedure: Text200 | None = None
    collected_at: datetime | None = None
    received_at: datetime | None = None
    blocks: Annotated[list[BlockDraft], Field(max_length=100)] = []

    @model_validator(mode="after")
    def unique_blocks(self) -> SpecimenDraft:
        numbers = [block.number for block in self.blocks]
        if len(numbers) != len(set(numbers)):
            raise ValueError("Block numbers must be unique within a specimen")
        return self


class CaseDraft(BaseModel):
    patient_id: uuid.UUID | None = None
    patient: NewPatient | None = None
    specimens: Annotated[list[SpecimenDraft], Field(min_length=1, max_length=26)]
    clinical_note: Annotated[str, StringConstraints(max_length=4000)] | None = None
    clinical_question: Annotated[str, StringConstraints(max_length=1000)] | None = None
    requester: Text200 | None = None
    priority: Priority = Priority.ROUTINE
    prefix: Annotated[str, StringConstraints(pattern=r"^[A-Z]{1,4}$")] | None = None
    accession: Annotated[str, StringConstraints(max_length=40)] | None = None
    service: Annotated[str, StringConstraints(max_length=60)] | None = None
    due_at: datetime | None = None
    assignee_user_id: uuid.UUID | None = None
    draft: bool = False

    @model_validator(mode="after")
    def one_patient(self) -> CaseDraft:
        if (self.patient_id is None) == (self.patient is None):
            raise ValueError("Give either patient_id or patient, not both")
        letters = [specimen.letter for specimen in self.specimens]
        if len(letters) != len(set(letters)):
            raise ValueError("Specimen letters must be unique within a case")
        return self


@dataclass(frozen=True)
class CaseDefaults:
    service: str | None = None
    due_at: datetime | None = None
    assignee_user_id: uuid.UUID | None = None


class DefaultRules(Protocol):
    async def defaults_for(
        self, connection: AsyncConnection, tenant_id: uuid.UUID, draft: CaseDraft
    ) -> CaseDefaults: ...


class NoRulesYet:
    async def defaults_for(
        self, connection: AsyncConnection, tenant_id: uuid.UUID, draft: CaseDraft
    ) -> CaseDefaults:
        return CaseDefaults()


RULES: DefaultRules = NoRulesYet()


class PatientExistsError(ConflictError):
    code = "patient-exists"
    title = "A patient with this MRN already exists. Create the case for that patient"


class AssigneeNotMemberError(BadRequestError):
    code = "assignee-not-member"
    title = "The assignee must be a member of this workspace"


class OnlyMembersCreateError(ForbiddenError):
    code = "members-only"
    title = "Only members of this workspace create cases"


def creator_of(principal: Principal) -> MemberPrincipal:
    if not isinstance(principal, MemberPrincipal):
        raise OnlyMembersCreateError
    return principal


async def existing_case(
    connection: AsyncConnection, creator: MemberPrincipal, key: str | None
) -> uuid.UUID | None:
    if key is None:
        return None
    await connection.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(f"case-request:{creator.user_id}:{key}", 0)
            )
        )
    )
    return await connection.scalar(
        select(case_requests.c.case_id).where(
            case_requests.c.tenant_id == creator.tenant_id,
            case_requests.c.user_id == creator.user_id,
            case_requests.c.request_key == key,
        )
    )


async def patient_for(connection: AsyncConnection, keys: TenantKeys, draft: CaseDraft) -> uuid.UUID:
    if draft.patient_id is not None:
        found = await connection.scalar(
            select(
                exists().where(patients.c.id == draft.patient_id, patients.c.deleted_at.is_(None))
            )
        )
        if not found:
            raise NotFoundError("Patient not found")
        return draft.patient_id
    assert draft.patient is not None
    new = draft.patient
    if new.mrn is not None and await find_patients(connection, keys, mrn=new.mrn):
        raise PatientExistsError
    patient_id = await add_patient(
        connection, keys, PatientIdentity(new.name, new.mrn, new.birth_date)
    )
    await connection.execute(
        patients.update()
        .where(patients.c.id == patient_id)
        .values(sex=new.sex, age_years=new.age_years)
    )
    return patient_id


async def accession_for(connection: AsyncConnection, tenant_id: uuid.UUID, draft: CaseDraft) -> str:
    if draft.accession is not None:
        return await check_imported_accession(connection, tenant_id, draft.accession)
    prefix = draft.prefix or (await format_of(connection, tenant_id)).prefixes[0]
    return await allocate_accession(connection, tenant_id, prefix, await current_year(connection))


async def check_assignee(
    connection: AsyncConnection, tenant_id: uuid.UUID, assignee: uuid.UUID | None
) -> None:
    if assignee is None:
        return
    member = await connection.scalar(
        select(
            exists().where(memberships.c.tenant_id == tenant_id, memberships.c.user_id == assignee)
        )
    )
    if not member:
        raise AssigneeNotMemberError


async def insert_specimens(
    connection: AsyncConnection, tenant_id: uuid.UUID, case_id: uuid.UUID, draft: CaseDraft
) -> None:
    for specimen in draft.specimens:
        specimen_id = uuid.uuid4()
        await connection.execute(
            insert(specimens).values(
                id=specimen_id,
                tenant_id=tenant_id,
                case_id=case_id,
                **specimen.model_dump(exclude={"blocks"}),
            )
        )
        for block in specimen.blocks:
            await connection.execute(
                insert(blocks).values(
                    tenant_id=tenant_id,
                    case_id=case_id,
                    specimen_id=specimen_id,
                    **block.model_dump(),
                )
            )


router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.post(
    "",
    operation_id="createCase",
    status_code=201,
    **require(Permission.EDIT_CASES, write=True),
)
async def create_case(
    draft: CaseDraft,
    request: Request,
    response: Response,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    idempotency_key: Annotated[str | None, Header(max_length=100)] = None,
) -> CaseDetail:
    creator = creator_of(principal)
    tenant_id = creator.tenant_id
    keyring = keyring_of(request)
    repeated = await existing_case(connection, creator, idempotency_key)
    if repeated is not None:
        response.status_code = 200
        return await case_detail(connection, keyring, principal, repeated)
    defaults = await RULES.defaults_for(connection, tenant_id, draft)
    assignee = draft.assignee_user_id or defaults.assignee_user_id
    await check_assignee(connection, tenant_id, assignee)
    keys = await ensure_keys(connection, keyring, tenant_id)
    patient_id = await patient_for(connection, keys, draft)
    case_id = uuid.uuid4()
    await connection.execute(
        insert(cases).values(
            id=case_id,
            tenant_id=tenant_id,
            patient_id=patient_id,
            accession=await accession_for(connection, tenant_id, draft),
            priority=draft.priority,
            due_at=draft.due_at or defaults.due_at,
            service=draft.service or defaults.service,
            source=CaseSource.MANUAL,
            assignee_user_id=assignee,
            requester=draft.requester,
            is_draft=draft.draft,
            clinical_note=seal_field(keys, "cases", case_id, "clinical_note", draft.clinical_note),
            clinical_question=seal_field(
                keys, "cases", case_id, "clinical_question", draft.clinical_question
            ),
            created_by_user_id=creator.user_id,
        )
    )
    await insert_specimens(connection, tenant_id, case_id, draft)
    if idempotency_key is not None:
        await connection.execute(
            upsert(case_requests).values(
                tenant_id=tenant_id,
                user_id=creator.user_id,
                request_key=idempotency_key,
                case_id=case_id,
            )
        )
    await record(
        connection,
        actor_of(principal),
        AuditAction.CASE_CREATED,
        AuditTarget.CASE,
        case_id,
        tenant_id=tenant_id,
        details={
            "source": CaseSource.MANUAL,
            "draft": draft.draft,
            "priority": draft.priority,
            "new_patient": draft.patient is not None,
            "specimens": len(draft.specimens),
        },
    )
    return await case_detail(connection, keyring, principal, case_id)
