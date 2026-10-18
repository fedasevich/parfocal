import uuid
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Request, status
from fastapi.encoders import jsonable_encoder
from geoalchemy2 import Geometry
from pydantic import BaseModel
from sqlalchemy import (
    Column,
    LargeBinary,
    Table,
    delete,
    exists,
    or_,
    select,
    update,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, forget, record
from parfocal_api.auth import AUTH_SCOPE
from parfocal_api.cases import keyring_of
from parfocal_api.context import (
    CurrentPrincipal,
    PlatformConnection,
    TenantConnection,
    UserConnection,
    engine_of,
)
from parfocal_api.identifiers import load_keys, read_patient
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import role_in
from parfocal_api.review_tasks import code_of as task_code
from parfocal_api.tables import (
    ProjectRole,
    audit_events,
    audit_people,
    cases,
    legal_holds,
    memberships,
    patients,
    result_sets,
    review_task_slides,
    review_tasks,
    sessions,
    slides,
    users,
)
from parfocal_api.users import own_workspaces, signed_in
from parfocal_common.data_classes import SECRET
from parfocal_common.db import DatabaseScope, metadata, scoped_transaction

FORMER_NAME = "Former member"
FORMER_INITIALS = "FM"
GLOBAL_PERSON_TABLES = frozenset(
    {"users", "sessions", "auth_logins", "platform_operators", "audit_people", "audit_events"}
)
EMAIL_TABLES = {"invitations": "email"}
EXPORTED_ELSEWHERE = {
    "users": "the profile",
    "sessions": "the session list",
    "audit_people": "the audit list, which resolves the pseudonym",
    "audit_events": "the audit list",
}
NOT_EXPORTED = {
    "platform_operators": "operators are Parfocal staff accounts outside any workspace",
    "rate_counters": "counters live for five minutes and hold only an id",
}


class WorkspaceData(BaseModel):
    tenant_id: uuid.UUID
    name: str
    records: dict[str, list[dict[str, Any]]]
    audit: list[dict[str, Any]]


class PersonalData(BaseModel):
    exported_at: datetime
    profile: dict[str, Any]
    sessions: list[dict[str, Any]]
    workspaces: list[WorkspaceData]


class PatientCase(BaseModel):
    id: uuid.UUID
    label: str
    created_at: datetime


class PatientSlide(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    label: str
    stain: str | None
    result_sets: list[str]
    review_tasks: list[str]


class PatientData(BaseModel):
    patient_id: uuid.UUID
    name: str
    mrn: str | None
    birth_date: date | None
    sex: str
    age_years: int | None
    cases: list[PatientCase]
    slides: list[PatientSlide]


class ErasedPatient(BaseModel):
    patient_id: uuid.UUID
    cases_unlinked: int


class ErasedPerson(BaseModel):
    user_id: uuid.UUID
    sessions_ended: int
    memberships_removed: int
    memberships_kept: int


class PatientNotFoundError(NotFoundError):
    code = "patient-not-found"
    title = "There is no such patient in this project"


class OwnersHandlePatientRequestsError(ForbiddenError):
    code = "owners-handle-patient-requests"
    title = "Only the project's owners export or erase a patient"


class HeldError(ConflictError):
    code = "legal-hold"
    title = "A legal hold keeps this data"


class PersonNotFoundError(NotFoundError):
    code = "person-not-found"
    title = "There is no such person"


me_router = APIRouter(prefix="/api/me", tags=["me"])
project_router = APIRouter(prefix="/api/projects/{project_id}/patients", tags=["patients"])
platform_router = APIRouter(prefix="/api/platform/users", tags=["platform"])


def person_columns() -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for table in metadata.sorted_tables:
        if table.name in GLOBAL_PERSON_TABLES or "tenant_id" not in table.c:
            continue
        named = [
            column.name
            for column in table.c
            if column.name == "user_id" or column.name.endswith("_user_id")
        ]
        if named:
            found[table.name] = named
    return found


def plain(row: Any) -> dict[str, Any]:
    return jsonable_encoder(dict(row._mapping))


def exported(column: Column[Any]) -> bool:
    return column.info is not SECRET and not isinstance(column.type, Geometry | LargeBinary)


async def rows_about(
    connection: AsyncConnection, table: Table, columns: list[str], user_id: uuid.UUID
) -> list[dict[str, Any]]:
    shown = [column for column in table.c if exported(column)]
    rows = await connection.execute(
        select(*shown).where(or_(*(table.c[name] == user_id for name in columns)))
    )
    return [plain(row) for row in rows]


async def own_audit(connection: AsyncConnection, subject: str) -> list[dict[str, Any]]:
    pseudonym = await connection.scalar(
        select(audit_people.c.id).where(audit_people.c.subject == subject)
    )
    if pseudonym is None:
        return []
    rows = await connection.execute(
        select(
            audit_events.c.seq,
            audit_events.c.occurred_at,
            audit_events.c.action,
            audit_events.c.target_type,
            audit_events.c.target_id,
        )
        .where(or_(audit_events.c.actor_id == pseudonym, audit_events.c.target_id == pseudonym))
        .order_by(audit_events.c.seq)
    )
    return [plain(row) for row in rows]


@me_router.get("/personal-data", operation_id="exportMyPersonalData")
async def export_my_personal_data(
    request: Request, principal: CurrentPrincipal, connection: UserConnection
) -> PersonalData:
    person = signed_in(principal)
    profile = (
        await connection.execute(
            select(
                users.c.id,
                users.c.subject,
                users.c.email,
                users.c.display_name,
                users.c.initials,
                users.c.title,
            ).where(users.c.id == person.user_id)
        )
    ).one()
    workspaces = await own_workspaces(connection, person.user_id)
    engine = engine_of(request)
    async with scoped_transaction(engine, AUTH_SCOPE) as auth:
        own_sessions = [
            plain(row)
            for row in await auth.execute(
                select(sessions.c.created_at, sessions.c.last_seen_at, sessions.c.user_agent).where(
                    sessions.c.subject == profile.subject
                )
            )
        ]
    columns = person_columns()
    found: list[WorkspaceData] = []
    for workspace in workspaces:
        scope = DatabaseScope(tenant_id=workspace.tenant_id, user_id=person.user_id)
        async with scoped_transaction(engine, scope) as tenant:
            records = {
                name: await rows_about(tenant, metadata.tables[name], named, person.user_id)
                for name, named in columns.items()
            }
            for name, column in EMAIL_TABLES.items():
                if profile.email:
                    table = metadata.tables[name]
                    shown = [item for item in table.c if exported(item)]
                    records[name] = [
                        plain(row)
                        for row in await tenant.execute(
                            select(*shown).where(table.c[column] == profile.email)
                        )
                    ]
            found.append(
                WorkspaceData(
                    tenant_id=workspace.tenant_id,
                    name=workspace.name,
                    records={name: rows for name, rows in records.items() if rows},
                    audit=await own_audit(tenant, profile.subject),
                )
            )
            await record(
                tenant,
                actor_of(person),
                AuditAction.PERSONAL_DATA_EXPORTED,
                AuditTarget.PERSON,
                person=profile.subject,
                tenant_id=workspace.tenant_id,
            )
    return PersonalData(
        exported_at=datetime.now().astimezone(),
        profile=plain(profile),
        sessions=own_sessions,
        workspaces=found,
    )


async def owned_patient(
    connection: AsyncConnection,
    principal: CurrentPrincipal,
    project_id: uuid.UUID,
    patient_id: uuid.UUID,
) -> Any:
    row = (
        await connection.execute(
            select(patients.c.id, patients.c.sex, patients.c.age_years, patients.c.tenant_id).where(
                patients.c.id == patient_id, patients.c.project_id == project_id
            )
        )
    ).one_or_none()
    if row is None:
        raise PatientNotFoundError
    if await role_in(connection, principal, project_id) is not ProjectRole.OWNER:
        raise OwnersHandlePatientRequestsError
    return row


@project_router.get(
    "/{patient_id}/personal-data",
    operation_id="exportPatientData",
    **require(Permission.CREATE_CASES),
)
async def export_patient_data(
    project_id: uuid.UUID,
    patient_id: uuid.UUID,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> PatientData:
    row = await owned_patient(connection, principal, project_id, patient_id)
    keys = await load_keys(connection, keyring_of(request), row.tenant_id)
    identity = await read_patient(connection, keys, patient_id)
    own_cases = (
        await connection.execute(
            select(cases.c.id, cases.c.label, cases.c.created_at)
            .where(cases.c.patient_id == patient_id)
            .order_by(cases.c.created_at, cases.c.id)
        )
    ).all()
    case_ids = [case.id for case in own_cases]
    found: list[PatientSlide] = []
    for slide in await connection.execute(
        select(slides.c.id, slides.c.case_id, slides.c.label, slides.c.stain)
        .where(slides.c.case_id.in_(case_ids))
        .order_by(slides.c.created_at, slides.c.id)
    ):
        names = await connection.scalars(
            select(result_sets.c.name)
            .where(result_sets.c.slide_id == slide.id)
            .order_by(result_sets.c.created_at)
        )
        numbers = await connection.scalars(
            select(review_tasks.c.number)
            .join(review_task_slides, review_task_slides.c.task_id == review_tasks.c.id)
            .where(review_task_slides.c.slide_id == slide.id)
            .order_by(review_tasks.c.number)
        )
        found.append(
            PatientSlide(
                id=slide.id,
                case_id=slide.case_id,
                label=slide.label,
                stain=slide.stain,
                result_sets=list(names),
                review_tasks=[task_code(number) for number in numbers],
            )
        )
    await record(
        connection,
        actor_of(principal),
        AuditAction.PATIENT_DATA_EXPORTED,
        AuditTarget.PATIENT,
        patient_id,
        tenant_id=row.tenant_id,
    )
    return PatientData(
        patient_id=patient_id,
        name=identity.name,
        mrn=identity.mrn,
        birth_date=identity.birth_date,
        sex=row.sex,
        age_years=row.age_years,
        cases=[
            PatientCase(id=case.id, label=case.label, created_at=case.created_at)
            for case in own_cases
        ],
        slides=found,
    )


@project_router.delete(
    "/{patient_id}",
    operation_id="erasePatient",
    **require(Permission.CREATE_CASES, write=True),
)
async def erase_patient(
    project_id: uuid.UUID,
    patient_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> ErasedPatient:
    row = await owned_patient(connection, principal, project_id, patient_id)
    held = await connection.scalar(
        select(
            exists().where(
                legal_holds.c.released_at.is_(None),
                or_(legal_holds.c.project_id.is_(None), legal_holds.c.project_id == project_id),
            )
        )
    )
    if held:
        raise HeldError
    unlinked = await connection.execute(
        update(cases).where(cases.c.patient_id == patient_id).values(patient_id=None)
    )
    await connection.execute(delete(patients).where(patients.c.id == patient_id))
    await record(
        connection,
        actor_of(principal),
        AuditAction.PATIENT_ERASED,
        AuditTarget.PATIENT,
        patient_id,
        tenant_id=row.tenant_id,
        details={"cases_unlinked": unlinked.rowcount},
    )
    return ErasedPatient(patient_id=patient_id, cases_unlinked=unlinked.rowcount)


@platform_router.post(
    "/{user_id}/erase", operation_id="erasePerson", status_code=status.HTTP_200_OK
)
async def erase_person(
    user_id: uuid.UUID,
    request: Request,
    principal: CurrentPrincipal,
    connection: PlatformConnection,
) -> ErasedPerson:
    subject = await connection.scalar(select(users.c.subject).where(users.c.id == user_id))
    if subject is None:
        raise PersonNotFoundError
    erased = f"erased:{uuid.uuid4()}"
    await connection.execute(
        update(users)
        .where(users.c.id == user_id)
        .values(
            subject=erased,
            email=None,
            display_name=FORMER_NAME,
            initials=FORMER_INITIALS,
            title=None,
        )
    )
    await connection.execute(
        update(memberships).where(memberships.c.user_id == user_id).values(availability_note=None)
    )
    removed = kept = 0
    for tenant_id in list(
        await connection.scalars(
            select(memberships.c.tenant_id).where(memberships.c.user_id == user_id)
        )
    ):
        try:
            async with connection.begin_nested():
                await connection.execute(
                    delete(memberships).where(
                        memberships.c.user_id == user_id, memberships.c.tenant_id == tenant_id
                    )
                )
            removed += 1
        except IntegrityError:
            kept += 1
    await forget(connection, subject)
    await record(
        connection,
        actor_of(principal),
        AuditAction.PERSON_ERASED,
        AuditTarget.PERSON,
        person=erased,
        details={"memberships_removed": removed, "memberships_kept": kept},
    )
    async with scoped_transaction(engine_of(request), AUTH_SCOPE) as auth:
        ended = await auth.execute(delete(sessions).where(sessions.c.subject == subject))
    return ErasedPerson(
        user_id=user_id,
        sessions_ended=ended.rowcount,
        memberships_removed=removed,
        memberships_kept=kept,
    )
