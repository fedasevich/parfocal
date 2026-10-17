import itertools
import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.class_templates import TEMPLATES, TaxonomyTemplate
from parfocal_api.colours import separation
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import BadRequestError
from parfocal_api.projects import ProjectArchivedError, owned, visible
from parfocal_api.tables import class_mappings, project_classes

MIN_BETWEEN_CLASSES = 15.0
RESERVED = (
    ("#ffffff", "unsure zones on the slide", 13.0),
    ("#0b0b0b", "AI proposals", 40.0),
    ("#cbd5e1", "unsure marks in the dark panel", 15.0),
    ("#475569", "unsure marks in the light panel", 15.0),
)

type ClassName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)
]
type Colour = Annotated[
    str,
    StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$"),
    AfterValidator(str.lower),
]
type SourceName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=120),
    AfterValidator(str.casefold),
]


class ClassDraft(BaseModel):
    id: uuid.UUID | None = None
    key: Annotated[int, Field(ge=1, le=9)]
    name: ClassName
    colour: Colour


class TaxonomyChange(BaseModel):
    classes: Annotated[list[ClassDraft], Field(max_length=9)]

    @model_validator(mode="after")
    def distinct(self) -> TaxonomyChange:
        keys = [draft.key for draft in self.classes]
        names = [draft.name.casefold() for draft in self.classes]
        ids = [draft.id for draft in self.classes if draft.id is not None]
        if len(set(keys)) != len(keys):
            raise ValueError("Each class needs its own key")
        if len(set(names)) != len(names):
            raise ValueError("Each class needs its own name")
        if len(set(ids)) != len(ids):
            raise ValueError("A class appears twice")
        return self


class ProjectClass(BaseModel):
    id: uuid.UUID
    key: int
    name: str
    colour: str


class TemplateClass(BaseModel):
    key: int
    name: str
    colour: str


class Template(BaseModel):
    template: TaxonomyTemplate
    classes: list[TemplateClass]


class ClassMapping(BaseModel):
    source_name: SourceName
    class_id: uuid.UUID


class MappingChange(BaseModel):
    mappings: Annotated[list[ClassMapping], Field(min_length=1, max_length=200)]


class Resolved(BaseModel):
    source_name: str
    class_id: uuid.UUID | None


class ColoursTooCloseError(BadRequestError):
    code = "colours-too-close"
    title = "Two class colours are too hard to tell apart"


class UnknownClassError(BadRequestError):
    code = "unknown-class"
    title = "This class is not in the project"


router = APIRouter(prefix="/api/projects", tags=["projects"])
templates_router = APIRouter(prefix="/api/taxonomy-templates", tags=["projects"])


def too_close(classes: list[ClassDraft]) -> str | None:
    for first, second in itertools.combinations(classes, 2):
        distance, vision = separation(first.colour, second.colour)
        if distance < MIN_BETWEEN_CLASSES:
            return (
                f"{first.name} and {second.name} are {distance:.1f} apart under {vision} vision "
                f"and need at least {MIN_BETWEEN_CLASSES:.0f}"
            )
    for draft, (colour, mark, needed) in itertools.product(classes, RESERVED):
        distance, vision = separation(draft.colour, colour)
        if distance < needed:
            return (
                f"{draft.name} is {distance:.1f} from {mark} under {vision} vision "
                f"and needs at least {needed:.0f}"
            )
    return None


async def classes_of(connection: AsyncConnection, project_id: uuid.UUID) -> list[ProjectClass]:
    rows = await connection.execute(
        select(project_classes)
        .where(project_classes.c.project_id == project_id)
        .order_by(project_classes.c.key)
    )
    return [ProjectClass.model_validate(row, from_attributes=True) for row in rows]


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    details: dict[str, int],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.PROJECT,
        project_id,
        tenant_id=tenant_id,
        details=details,
    )


@templates_router.get("", operation_id="listTaxonomyTemplates")
async def list_taxonomy_templates(connection: TenantConnection) -> list[Template]:
    return [
        Template(
            template=template,
            classes=[
                TemplateClass(key=key, name=name, colour=colour)
                for key, (name, colour) in enumerate(classes, start=1)
            ],
        )
        for template, classes in TEMPLATES.items()
    ]


@router.get(
    "/{project_id}/classes",
    operation_id="listProjectClasses",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_project_classes(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[ProjectClass]:
    await visible(connection, principal, project_id)
    return await classes_of(connection, project_id)


@router.put(
    "/{project_id}/classes",
    operation_id="setProjectClasses",
    **require(Permission.CREATE_CASES, write=True),
)
async def set_project_classes(
    project_id: uuid.UUID,
    change: TaxonomyChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[ProjectClass]:
    project = await owned(connection, principal, project_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    problem = too_close(change.classes)
    if problem is not None:
        raise ColoursTooCloseError(problem)
    existing = {item.id for item in await classes_of(connection, project_id)}
    kept = {draft.id for draft in change.classes if draft.id is not None}
    if not kept <= existing:
        raise UnknownClassError
    await connection.execute(
        delete(project_classes).where(
            project_classes.c.project_id == project_id, project_classes.c.id.not_in(kept)
        )
    )
    for draft in change.classes:
        if draft.id is not None:
            await connection.execute(
                update(project_classes)
                .where(project_classes.c.id == draft.id)
                .values(name=str(draft.id))
            )
    for draft in change.classes:
        values = {"key": draft.key, "name": draft.name, "colour": draft.colour}
        if draft.id is None:
            await connection.execute(
                insert(project_classes).values(
                    tenant_id=project.tenant_id, project_id=project_id, **values
                )
            )
        else:
            await connection.execute(
                update(project_classes).where(project_classes.c.id == draft.id).values(**values)
            )
    await audit(
        connection,
        principal,
        AuditAction.PROJECT_TAXONOMY_CHANGED,
        project.tenant_id,
        project_id,
        {
            "classes": len(change.classes),
            "added": len(change.classes) - len(kept),
            "removed": len(existing - kept),
        },
    )
    return await classes_of(connection, project_id)


@router.get(
    "/{project_id}/class-mappings",
    operation_id="listClassMappings",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_class_mappings(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[ClassMapping]:
    await visible(connection, principal, project_id)
    rows = await connection.execute(
        select(class_mappings.c.source_name, class_mappings.c.class_id)
        .where(class_mappings.c.project_id == project_id)
        .order_by(class_mappings.c.source_name)
    )
    return [ClassMapping.model_validate(row, from_attributes=True) for row in rows]


@router.put(
    "/{project_id}/class-mappings",
    operation_id="rememberClassMappings",
    **require(Permission.CREATE_CASES, write=True),
)
async def remember_class_mappings(
    project_id: uuid.UUID,
    change: MappingChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[ClassMapping]:
    project = await owned(connection, principal, project_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    known = {item.id for item in await classes_of(connection, project_id)}
    if any(mapping.class_id not in known for mapping in change.mappings):
        raise UnknownClassError
    latest = {mapping.source_name: mapping.class_id for mapping in change.mappings}
    for source_name, class_id in latest.items():
        await connection.execute(
            upsert(class_mappings)
            .values(
                tenant_id=project.tenant_id,
                project_id=project_id,
                source_name=source_name,
                class_id=class_id,
            )
            .on_conflict_do_update(
                index_elements=[class_mappings.c.project_id, class_mappings.c.source_name],
                set_={"class_id": class_id},
            )
        )
    await audit(
        connection,
        principal,
        AuditAction.PROJECT_MAPPINGS_CHANGED,
        project.tenant_id,
        project_id,
        {"mappings": len(latest)},
    )
    return await list_class_mappings(project_id, principal, connection)


async def resolve_names(
    connection: AsyncConnection, project_id: uuid.UUID, names: list[str]
) -> list[Resolved]:
    by_name = {item.name.casefold(): item.id for item in await classes_of(connection, project_id)}
    stored = {
        row.source_name: row.class_id
        for row in await connection.execute(
            select(class_mappings.c.source_name, class_mappings.c.class_id).where(
                class_mappings.c.project_id == project_id
            )
        )
    }
    resolved: list[Resolved] = []
    for name in names:
        key = name.strip().casefold()
        resolved.append(Resolved(source_name=name, class_id=stored.get(key) or by_name.get(key)))
    return resolved


@router.get(
    "/{project_id}/class-mappings/resolve",
    operation_id="resolveClassNames",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def resolve_class_names(
    project_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    name: Annotated[list[str], Query(min_length=1, max_length=200)],
) -> list[Resolved]:
    await visible(connection, principal, project_id)
    return await resolve_names(connection, project_id, name)
