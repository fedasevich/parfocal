import uuid
from enum import StrEnum
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.cases import keyring_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.identifiers import find_patients, load_keys
from parfocal_api.my_work import ProjectRef
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, database_scope
from parfocal_api.project_access import readable, readable_slide
from parfocal_api.projects import code_of
from parfocal_api.tables import PrivacyMode, cases, memberships, projects, slides, users
from parfocal_common.envelope import DataKeyUnavailableError
from parfocal_common.object_ids import LOOSE_CASE, ObjectIdError, parse

PER_KIND = 20

Term = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]


class SearchScope(StrEnum):
    ALL = "all"
    PROJECTS = "projects"
    CASES = "cases"
    SLIDES = "slides"
    OBJECTS = "objects"
    PEOPLE = "people"
    PATIENTS = "patients"


class HitKind(StrEnum):
    PROJECT = "project"
    CASE = "case"
    SLIDE = "slide"
    OBJECT = "object"
    PERSON = "person"
    PATIENT_CASE = "patient-case"


class SearchHit(BaseModel):
    kind: HitKind
    id: uuid.UUID
    label: str
    project: ProjectRef | None = None
    case_label: str | None = None
    slide_id: uuid.UUID | None = None
    object_id: str | None = None


class SearchResults(BaseModel):
    query: str
    hits: list[SearchHit]


router = APIRouter(prefix="/api/search", tags=["search"])


def pattern(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"


def project_ref(row: Any) -> ProjectRef:
    return ProjectRef(id=row.project_id, code=code_of(row.project_number), name=row.project_name)


SLIDE_COLUMNS = (
    slides.c.id,
    slides.c.label,
    slides.c.project_id,
    projects.c.number.label("project_number"),
    projects.c.name.label("project_name"),
    cases.c.label.label("case_label"),
)


def visible_slides(principal: CurrentPrincipal) -> Any:
    return (
        select(*SLIDE_COLUMNS)
        .join(projects, projects.c.id == slides.c.project_id)
        .outerjoin(cases, cases.c.id == slides.c.case_id)
        .where(
            slides.c.deleted_at.is_(None),
            readable_slide(principal, slides.c.project_id, slides.c.id),
        )
    )


async def project_hits(
    connection: AsyncConnection, principal: CurrentPrincipal, term: str
) -> list[SearchHit]:
    rows = await connection.execute(
        select(projects.c.id, projects.c.number, projects.c.name)
        .where(readable(principal, projects.c.id), projects.c.name.ilike(pattern(term)))
        .order_by(projects.c.number)
        .limit(PER_KIND)
    )
    return [
        SearchHit(
            kind=HitKind.PROJECT,
            id=row.id,
            label=row.name,
            project=ProjectRef(id=row.id, code=code_of(row.number), name=row.name),
        )
        for row in rows
    ]


async def case_hits(
    connection: AsyncConnection, principal: CurrentPrincipal, term: str
) -> list[SearchHit]:
    rows = await connection.execute(
        select(
            cases.c.id,
            cases.c.label,
            cases.c.project_id,
            projects.c.number.label("project_number"),
            projects.c.name.label("project_name"),
        )
        .join(projects, projects.c.id == cases.c.project_id)
        .where(readable(principal, cases.c.project_id), cases.c.label.ilike(pattern(term)))
        .order_by(cases.c.label)
        .limit(PER_KIND)
    )
    return [
        SearchHit(kind=HitKind.CASE, id=row.id, label=row.label, project=project_ref(row))
        for row in rows
    ]


async def slide_hits(
    connection: AsyncConnection, principal: CurrentPrincipal, term: str
) -> list[SearchHit]:
    rows = await connection.execute(
        visible_slides(principal)
        .where(slides.c.label.ilike(pattern(term)))
        .order_by(slides.c.label)
        .limit(PER_KIND)
    )
    return [
        SearchHit(
            kind=HitKind.SLIDE,
            id=row.id,
            label=row.label,
            project=project_ref(row),
            case_label=row.case_label,
            slide_id=row.id,
        )
        for row in rows
    ]


async def object_hits(
    connection: AsyncConnection, principal: CurrentPrincipal, term: str
) -> list[SearchHit]:
    segments = term.split("/")
    if len(segments) < 2 or len(segments) > 4:
        return []
    try:
        found = parse(segments[-1])
    except ObjectIdError:
        return []
    statement = visible_slides(principal).where(slides.c.label == segments[-2])
    if len(segments) >= 3:
        case = segments[-3]
        statement = statement.where(
            slides.c.case_id.is_(None) if case == LOOSE_CASE else cases.c.label == case
        )
    if len(segments) == 4:
        code = segments[0].upper().removeprefix("P")
        if not code.isdigit():
            return []
        statement = statement.where(projects.c.number == int(code))
    rows = await connection.execute(statement.order_by(slides.c.label).limit(PER_KIND))
    text = found.text(ascii=True)
    return [
        SearchHit(
            kind=HitKind.OBJECT,
            id=row.id,
            label=f"{row.label} {text}",
            project=project_ref(row),
            case_label=row.case_label,
            slide_id=row.id,
            object_id=text,
        )
        for row in rows
    ]


async def person_hits(
    connection: AsyncConnection, principal: CurrentPrincipal, term: str
) -> list[SearchHit]:
    if not isinstance(principal, MemberPrincipal):
        return []
    rows = await connection.execute(
        select(users.c.id, users.c.display_name)
        .join(memberships, memberships.c.user_id == users.c.id)
        .where(
            memberships.c.tenant_id == principal.tenant_id,
            users.c.display_name.ilike(pattern(term)),
        )
        .order_by(users.c.display_name)
        .limit(PER_KIND)
    )
    return [SearchHit(kind=HitKind.PERSON, id=row.id, label=row.display_name) for row in rows]


async def patient_hits(
    request: Request, connection: AsyncConnection, principal: CurrentPrincipal, term: str
) -> list[SearchHit]:
    clinical = (
        await connection.execute(
            select(projects.c.id, projects.c.number, projects.c.name).where(
                readable(principal, projects.c.id),
                projects.c.privacy_mode == PrivacyMode.CLINICAL,
            )
        )
    ).all()
    tenant_id = database_scope(principal).tenant_id
    if not clinical or tenant_id is None:
        return []
    try:
        keys = await load_keys(connection, keyring_of(request), tenant_id)
    except DataKeyUnavailableError:
        return []
    hits: list[SearchHit] = []
    for project in clinical:
        found = await find_patients(connection, keys, project.id, name=term)
        if not found:
            continue
        rows = await connection.execute(
            select(cases.c.id, cases.c.label)
            .where(and_(cases.c.project_id == project.id, cases.c.patient_id.in_(found)))
            .order_by(cases.c.label)
            .limit(PER_KIND)
        )
        reference = ProjectRef(id=project.id, code=code_of(project.number), name=project.name)
        hits.extend(
            SearchHit(kind=HitKind.PATIENT_CASE, id=row.id, label=row.label, project=reference)
            for row in rows
        )
    return hits[:PER_KIND]


@router.get("", operation_id="search", **require(Permission.SEE_SLIDES))
async def search(
    q: Term,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    scope: Annotated[SearchScope, Query()] = SearchScope.ALL,
) -> SearchResults:
    wanted = set(SearchScope) if scope is SearchScope.ALL else {scope}
    hits: list[SearchHit] = []
    if SearchScope.OBJECTS in wanted:
        hits += await object_hits(connection, principal, q)
    if SearchScope.PROJECTS in wanted:
        hits += await project_hits(connection, principal, q)
    if SearchScope.CASES in wanted:
        hits += await case_hits(connection, principal, q)
    if SearchScope.SLIDES in wanted:
        hits += await slide_hits(connection, principal, q)
    if SearchScope.PATIENTS in wanted:
        hits += await patient_hits(request, connection, principal, q)
    if SearchScope.PEOPLE in wanted:
        hits += await person_hits(connection, principal, q)
    return SearchResults(query=q, hits=hits)
