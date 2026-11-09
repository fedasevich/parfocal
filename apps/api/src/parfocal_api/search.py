import uuid
from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated, Any
from urllib.parse import unquote

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy import ColumnElement, and_, func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.blinding import ai_hidden, user_of
from parfocal_api.cases import keyring_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.identifiers import find_patients, load_keys
from parfocal_api.my_work import ProjectRef
from parfocal_api.origins import Origin, OriginRoute
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, database_scope
from parfocal_api.project_access import readable, readable_slide
from parfocal_api.projects import code_of
from parfocal_api.tables import (
    AnnotationKind,
    PrivacyMode,
    cases,
    memberships,
    projects,
    review_edits,
    slides,
    users,
)
from parfocal_common.envelope import DataKeyUnavailableError
from parfocal_common.object_ids import LOOSE_CASE, Letter, ObjectId, ObjectIdError, parse
from parfocal_common.object_lineage import Fate, Retired, resolve

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
    resolved_from: str | None = None
    task_id: uuid.UUID | None = None
    origin: Origin = Origin(route=OriginRoute.SEARCH)


class SearchResults(BaseModel):
    query: str
    hits: list[SearchHit]


router = APIRouter(prefix="/api/search", tags=["search"])


def pattern(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"


def contains(lowered: ColumnElement[str], term: str) -> ColumnElement[bool]:
    return lowered.like(func.lower(pattern(term)))


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
        .where(readable(principal, projects.c.id), contains(projects.c.name_lower, term))
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
        .where(readable(principal, cases.c.project_id), contains(cases.c.label_lower, term))
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
        .where(contains(slides.c.label_lower, term))
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


AI_LETTERS = {Letter.REGION, Letter.CELL, Letter.ZONE}
EDITED_KINDS = {Letter.REGION: AnnotationKind.REGION, Letter.CELL: AnnotationKind.CELL}


@dataclass(frozen=True)
class SearchContext:
    project_id: uuid.UUID | None = None
    slide_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None


def object_query(
    principal: CurrentPrincipal, segments: list[str], context: SearchContext
) -> Any | None:
    statement = visible_slides(principal)
    if len(segments) == 1:
        if context.slide_id is None:
            return None
        return statement.where(slides.c.id == context.slide_id)
    statement = statement.where(slides.c.label == segments[-2])
    if len(segments) >= 3:
        case = segments[-3]
        statement = statement.where(
            slides.c.case_id.is_(None) if case == LOOSE_CASE else cases.c.label == case
        )
    if len(segments) == 4:
        code = segments[0].upper().removeprefix("P")
        if not code.isdigit():
            return None
        return statement.where(projects.c.number == int(code))
    if context.project_id is not None:
        statement = statement.where(slides.c.project_id == context.project_id)
    return statement


async def current_ids(
    connection: AsyncConnection,
    principal: CurrentPrincipal,
    slide_id: uuid.UUID,
    found: ObjectId,
    context: SearchContext,
) -> tuple[uuid.UUID | None, list[ObjectId]]:
    kind = EDITED_KINDS.get(found.letter)
    user_id = user_of(principal)
    if kind is None or found.person or user_id is None:
        return None, [found]
    where = [
        review_edits.c.slide_id == slide_id,
        review_edits.c.user_id == user_id,
        review_edits.c.kind == kind,
    ]
    if context.task_id is not None:
        where.append(review_edits.c.task_id == context.task_id)
    task_id = await connection.scalar(
        select(review_edits.c.task_id)
        .where(*where)
        .group_by(review_edits.c.task_id)
        .order_by(func.max(review_edits.c.updated_at).desc())
        .limit(1)
    )
    if task_id is None:
        return context.task_id, [found]
    rows = await connection.execute(
        select(
            review_edits.c.number,
            review_edits.c.split,
            review_edits.c.deleted,
            review_edits.c.retired,
            review_edits.c.merged_into_number,
            review_edits.c.merged_into_split,
        ).where(*where, review_edits.c.task_id == task_id)
    )
    fates = {
        (row.number, row.split): Fate(
            deleted=row.deleted,
            retired=Retired(row.retired) if row.retired else None,
            merged_into=(
                (row.merged_into_number, row.merged_into_split)
                if row.merged_into_number is not None
                else None
            ),
        )
        for row in rows
    }
    plain = ObjectId(found.letter, found.number, found.split)
    resolved = resolve(found.letter, fates, plain)
    if resolved == [plain]:
        return task_id, [found]
    return task_id, resolved


async def object_hits(
    connection: AsyncConnection,
    principal: CurrentPrincipal,
    term: str,
    context: SearchContext,
) -> list[SearchHit]:
    segments = [unquote(segment) for segment in term.split("/")]
    if len(segments) > 4 or not all(segments):
        return []
    try:
        found = parse(segments[-1])
    except ObjectIdError:
        return []
    statement = object_query(principal, segments, context)
    if statement is None:
        return []
    if found.letter in AI_LETTERS and not found.person:
        statement = statement.where(~ai_hidden(principal, slides.c.project_id, slides.c.id))
    rows = await connection.execute(statement.order_by(slides.c.label).limit(PER_KIND))
    typed = found.text(ascii=True)
    hits: list[SearchHit] = []
    for row in rows:
        task_id, resolved = await current_ids(connection, principal, row.id, found, context)
        for item in resolved:
            text = item.text(ascii=True)
            hits.append(
                SearchHit(
                    kind=HitKind.OBJECT,
                    id=row.id,
                    label=f"{row.label} {text}"
                    if text == typed
                    else f"{row.label} {text} ({typed})",
                    project=project_ref(row),
                    case_label=row.case_label,
                    slide_id=row.id,
                    object_id=text,
                    resolved_from=None if text == typed else typed,
                    task_id=task_id,
                )
            )
    return hits[:PER_KIND]


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
    project_id: uuid.UUID | None = None,
    slide_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
) -> SearchResults:
    context = SearchContext(project_id=project_id, slide_id=slide_id, task_id=task_id)
    wanted = set(SearchScope) if scope is SearchScope.ALL else {scope}
    hits: list[SearchHit] = []
    if SearchScope.OBJECTS in wanted:
        hits += await object_hits(connection, principal, q, context)
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
    origin = Origin(
        route=OriginRoute.SEARCH, project_id=project_id, task_id=task_id, slide_id=slide_id
    )
    return SearchResults(query=q, hits=[hit.model_copy(update={"origin": origin}) for hit in hits])
