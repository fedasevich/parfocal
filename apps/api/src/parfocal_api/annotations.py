import json
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import bindparam, func, select, text, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.types import Integer, String, Uuid

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.numbering import reserve
from parfocal_api.permissions import Grant, Permission, require
from parfocal_api.principals import MemberPrincipal, Principal, database_scope
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.project_access import require_slide_reading, reviews_slide
from parfocal_api.projects import ProjectArchivedError
from parfocal_api.tables import (
    AnnotationChange,
    AnnotationKind,
    PrivacyMode,
    annotation_versions,
    annotations,
    project_classes,
    projects,
    slides,
)
from parfocal_common.object_ids import Letter, ObjectId

MAX_BULK = 10_000
DRAWS = frozenset({Grant.ALL, Grant.ASSIGNED})
MAX_VERTICES = 20_000
LETTERS = {
    AnnotationKind.ROI: Letter.ROI,
    AnnotationKind.MEASUREMENT: Letter.MEASUREMENT,
    AnnotationKind.REGION: Letter.REGION,
    AnnotationKind.CELL: Letter.CELL,
}
PERSON_MADE_AI_KINDS = frozenset({AnnotationKind.REGION, AnnotationKind.CELL})
SHAPES = {
    AnnotationKind.ROI: frozenset({"Polygon", "MultiPolygon"}),
    AnnotationKind.MEASUREMENT: frozenset({"LineString", "Polygon"}),
    AnnotationKind.REGION: frozenset({"Polygon", "MultiPolygon"}),
    AnnotationKind.CELL: frozenset({"Polygon", "Point"}),
}

type Coordinate = Annotated[float, Field(ge=-10_000_000, le=10_000_000, allow_inf_nan=False)]
type Position = tuple[Coordinate, Coordinate]
type Ring = Annotated[list[Position], Field(min_length=4)]


class PointGeometry(BaseModel):
    type: Literal["Point"]
    coordinates: Position


class LineStringGeometry(BaseModel):
    type: Literal["LineString"]
    coordinates: Annotated[list[Position], Field(min_length=2)]


class PolygonGeometry(BaseModel):
    type: Literal["Polygon"]
    coordinates: Annotated[list[Ring], Field(min_length=1)]


class MultiPolygonGeometry(BaseModel):
    type: Literal["MultiPolygon"]
    coordinates: Annotated[list[Annotated[list[Ring], Field(min_length=1)]], Field(min_length=1)]


type Geometry = Annotated[
    PointGeometry | LineStringGeometry | PolygonGeometry | MultiPolygonGeometry,
    Field(discriminator="type"),
]


def rings_of(geometry: Geometry) -> list[list[Position]]:
    match geometry:
        case PointGeometry():
            return [[geometry.coordinates]]
        case LineStringGeometry():
            return [geometry.coordinates]
        case PolygonGeometry():
            return geometry.coordinates
        case MultiPolygonGeometry():
            return [ring for polygon in geometry.coordinates for ring in polygon]


def checked(geometry: Geometry) -> Geometry:
    rings = rings_of(geometry)
    if sum(len(ring) for ring in rings) > MAX_VERTICES:
        raise ValueError(f"A shape has at most {MAX_VERTICES} points")
    if isinstance(geometry, PolygonGeometry | MultiPolygonGeometry) and any(
        ring[0] != ring[-1] for ring in rings
    ):
        raise ValueError("Every ring must end where it starts")
    return geometry


class AnnotationDraft(BaseModel):
    kind: AnnotationKind
    geometry: Geometry
    class_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def fits_kind(self) -> AnnotationDraft:
        checked(self.geometry)
        if self.geometry.type not in SHAPES[self.kind]:
            allowed = " or ".join(sorted(SHAPES[self.kind]))
            raise ValueError(f"A {self.kind} is a {allowed}")
        return self


class AnnotationDrafts(BaseModel):
    annotations: Annotated[list[AnnotationDraft], Field(min_length=1, max_length=MAX_BULK)]


class AnnotationEdit(BaseModel):
    version: Annotated[int, Field(ge=1)]
    geometry: Geometry | None = None
    class_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def has_change(self) -> AnnotationEdit:
        if self.geometry is not None:
            checked(self.geometry)
        if not {"geometry", "class_id"} & self.model_fields_set:
            raise ValueError("Change the shape or the class")
        return self


class VersionCheck(BaseModel):
    version: Annotated[int, Field(ge=1)]


class Annotation(BaseModel):
    id: uuid.UUID
    slide_id: uuid.UUID
    kind: AnnotationKind
    number: int
    code: str
    geometry: dict[str, Any]
    class_id: uuid.UUID | None
    version: int
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class AnnotationRef(BaseModel):
    id: uuid.UUID
    kind: AnnotationKind
    number: int
    code: str


class AnnotationVersion(BaseModel):
    version: int
    change: AnnotationChange
    geometry: dict[str, Any]
    class_id: uuid.UUID | None
    changed_by_user_id: uuid.UUID | None
    changed_at: datetime


class AnnotatingNotAllowedError(ForbiddenError):
    code = "annotating-not-allowed"
    title = "Only project owners and this slide's reviewers draw on it"


class InvalidShapeError(BadRequestError):
    code = "invalid-shape"
    title = "A shape is not valid"


class UnknownClassError(BadRequestError):
    code = "unknown-class"
    title = "A class is not in this project"


class AnnotationChangedError(ConflictError):
    code = "annotation-changed"
    title = "This shape changed since you loaded it"


router = APIRouter(prefix="/api/slides/{slide_id}/annotations", tags=["annotations"])

GEOJSON = func.ST_AsGeoJSON(annotations.c.geometry).label("geojson")
COLUMNS = (
    annotations.c.id,
    annotations.c.slide_id,
    annotations.c.kind,
    annotations.c.number,
    GEOJSON,
    annotations.c.class_id,
    annotations.c.version,
    annotations.c.created_by_user_id,
    annotations.c.created_at,
    annotations.c.updated_at,
    annotations.c.deleted_at,
)


def code_of(kind: AnnotationKind, number: int) -> str:
    person = kind in PERSON_MADE_AI_KINDS
    return ObjectId(LETTERS[kind], number, person=person).text(ascii=True)


def annotation_of(row: Any) -> Annotation:
    kind = AnnotationKind(row.kind)
    return Annotation(
        id=row.id,
        slide_id=row.slide_id,
        kind=kind,
        number=row.number,
        code=code_of(kind, row.number),
        geometry=json.loads(row.geojson),
        class_id=row.class_id,
        version=row.version,
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
    )


async def slide_row(connection: AsyncConnection, principal: Principal, slide_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(
            select(
                slides.c.id, slides.c.project_id, projects.c.privacy_mode, projects.c.archived_at
            )
            .join(projects, projects.c.id == slides.c.project_id)
            .where(slides.c.id == slide_id, slides.c.deleted_at.is_(None))
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Slide not found")
    await require_slide_reading(
        connection,
        principal,
        row.project_id,
        PrivacyMode(row.privacy_mode),
        slide_id,
        "Slide not found",
    )
    return row


async def drawable_slide(
    connection: AsyncConnection, principal: Principal, slide_id: uuid.UUID
) -> Any:
    row = await slide_row(connection, principal, slide_id)
    if await reviews_slide(connection, principal, row.project_id, slide_id) not in DRAWS:
        raise AnnotatingNotAllowedError
    if row.archived_at is not None:
        raise ProjectArchivedError
    return row


def author_of(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


async def check_classes(
    connection: AsyncConnection, project_id: uuid.UUID, class_ids: set[uuid.UUID]
) -> None:
    if not class_ids:
        return
    known = set(
        await connection.scalars(
            select(project_classes.c.id).where(
                project_classes.c.project_id == project_id,
                project_classes.c.id.in_(class_ids),
            )
        )
    )
    if class_ids - known:
        raise UnknownClassError


INVALID_SHAPE = text(
    "SELECT ord, ST_IsValidReason(ST_GeomFromGeoJSON(shape)) AS reason "
    "FROM unnest(:shapes) WITH ORDINALITY AS given(shape, ord) "
    "WHERE NOT ST_IsValid(ST_GeomFromGeoJSON(shape)) ORDER BY ord LIMIT 1"
).bindparams(bindparam("shapes", type_=ARRAY(String)))


async def check_shapes(connection: AsyncConnection, shapes: Sequence[str]) -> None:
    invalid = (await connection.execute(INVALID_SHAPE, {"shapes": list(shapes)})).one_or_none()
    if invalid is None:
        return
    where = f"Shape {invalid.ord}" if len(shapes) > 1 else "The shape"
    raise InvalidShapeError(f"{where} is not valid: {invalid.reason}")


INSERT_ANNOTATIONS = text(
    "INSERT INTO annotations "
    "(tenant_id, project_id, slide_id, kind, number, geometry, class_id, created_by_user_id) "
    "SELECT :tenant_id, :project_id, :slide_id, kind, number, "
    "ST_SetSRID(ST_GeomFromGeoJSON(shape), 0), class_id, :user_id "
    "FROM unnest(:kinds, :numbers, :shapes, :class_ids) AS given(kind, number, shape, class_id) "
    "RETURNING id, kind, number"
).bindparams(
    bindparam("kinds", type_=ARRAY(String)),
    bindparam("numbers", type_=ARRAY(Integer)),
    bindparam("shapes", type_=ARRAY(String)),
    bindparam("class_ids", type_=ARRAY(Uuid())),
)

RECORD_VERSIONS = text(
    "INSERT INTO annotation_versions "
    "(tenant_id, annotation_id, version, change, geometry, class_id, changed_by_user_id) "
    "SELECT tenant_id, id, version, :change, geometry, class_id, :user_id "
    "FROM annotations WHERE id = ANY(:ids)"
).bindparams(bindparam("ids", type_=ARRAY(Uuid())))


async def record_versions(
    connection: AsyncConnection,
    ids: Sequence[uuid.UUID],
    change: AnnotationChange,
    principal: Principal,
) -> None:
    await connection.execute(
        RECORD_VERSIONS, {"ids": list(ids), "change": change, "user_id": author_of(principal)}
    )


async def add(
    connection: AsyncConnection,
    principal: Principal,
    slide: Any,
    drafts: Sequence[AnnotationDraft],
) -> list[AnnotationRef]:
    await check_classes(
        connection, slide.project_id, {d.class_id for d in drafts if d.class_id is not None}
    )
    shapes = [draft.geometry.model_dump_json() for draft in drafts]
    await check_shapes(connection, shapes)
    tenant_id = database_scope(principal).tenant_id
    numbers: list[int] = [0] * len(drafts)
    for kind in AnnotationKind:
        positions = [index for index, draft in enumerate(drafts) if draft.kind is kind]
        if not positions:
            continue
        assert tenant_id is not None
        first = await reserve(connection, tenant_id, slide.id, LETTERS[kind], len(positions))
        for offset, index in enumerate(positions):
            numbers[index] = first + offset
    rows = (
        await connection.execute(
            INSERT_ANNOTATIONS,
            {
                "tenant_id": tenant_id,
                "project_id": slide.project_id,
                "slide_id": slide.id,
                "user_id": author_of(principal),
                "kinds": [draft.kind.value for draft in drafts],
                "numbers": numbers,
                "shapes": shapes,
                "class_ids": [draft.class_id for draft in drafts],
            },
        )
    ).all()
    await record_versions(connection, [row.id for row in rows], AnnotationChange.CREATED, principal)
    by_number = {(row.kind, row.number): row.id for row in rows}
    return [
        AnnotationRef(
            id=by_number[(draft.kind.value, number)],
            kind=draft.kind,
            number=number,
            code=code_of(draft.kind, number),
        )
        for draft, number in zip(drafts, numbers, strict=True)
    ]


async def one_annotation(
    connection: AsyncConnection, slide_id: uuid.UUID, annotation_id: uuid.UUID
) -> Annotation:
    row = (
        await connection.execute(
            select(*COLUMNS).where(
                annotations.c.id == annotation_id, annotations.c.slide_id == slide_id
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Annotation not found")
    return annotation_of(row)


@router.get("", operation_id="listAnnotations", **require(Permission.SEE_SLIDES, emergency=True))
async def list_annotations(
    slide_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    bbox: Annotated[list[float] | None, Query(min_length=4, max_length=4)] = None,
    kind: AnnotationKind | None = None,
) -> list[Annotation]:
    await slide_row(connection, principal, slide_id)
    statement = select(*COLUMNS).where(
        annotations.c.slide_id == slide_id, annotations.c.deleted_at.is_(None)
    )
    if bbox is not None:
        envelope = func.ST_MakeEnvelope(*bbox, 0)
        statement = statement.where(annotations.c.geometry.op("&&")(envelope))
    if kind is not None:
        statement = statement.where(annotations.c.kind == kind)
    rows = await connection.execute(statement.order_by(annotations.c.kind, annotations.c.number))
    return [annotation_of(row) for row in rows]


@router.post(
    "",
    operation_id="createAnnotation",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def create_annotation(
    slide_id: uuid.UUID,
    draft: AnnotationDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Annotation:
    slide = await drawable_slide(connection, principal, slide_id)
    (created,) = await add(connection, principal, slide, [draft])
    return await one_annotation(connection, slide_id, created.id)


@router.post(
    "/bulk",
    operation_id="createAnnotations",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def create_annotations(
    slide_id: uuid.UUID,
    drafts: AnnotationDrafts,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[AnnotationRef]:
    slide = await drawable_slide(connection, principal, slide_id)
    return await add(connection, principal, slide, drafts.annotations)


@router.get(
    "/{annotation_id}",
    operation_id="getAnnotation",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_annotation(
    slide_id: uuid.UUID,
    annotation_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Annotation:
    await slide_row(connection, principal, slide_id)
    return await one_annotation(connection, slide_id, annotation_id)


async def bump(
    connection: AsyncConnection,
    principal: Principal,
    slide_id: uuid.UUID,
    annotation_id: uuid.UUID,
    version: int,
    deleted: bool,
    values: dict[str, Any],
    change: AnnotationChange,
) -> Annotation:
    state = annotations.c.deleted_at.is_not(None) if deleted else annotations.c.deleted_at.is_(None)
    changed = await connection.scalar(
        update(annotations)
        .where(
            annotations.c.id == annotation_id,
            annotations.c.slide_id == slide_id,
            annotations.c.version == version,
            state,
        )
        .values(version=annotations.c.version + 1, **values)
        .returning(annotations.c.id)
    )
    if changed is None:
        current = await one_annotation(connection, slide_id, annotation_id)
        raise AnnotationChangedError(
            f"It is at version {current.version}{' and deleted' if current.deleted_at else ''}"
        )
    await record_versions(connection, [annotation_id], change, principal)
    return await one_annotation(connection, slide_id, annotation_id)


@router.patch(
    "/{annotation_id}",
    operation_id="changeAnnotation",
    **require(Permission.REVIEW, write=True),
)
async def change_annotation(
    slide_id: uuid.UUID,
    annotation_id: uuid.UUID,
    edit: AnnotationEdit,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Annotation:
    slide = await drawable_slide(connection, principal, slide_id)
    current = await one_annotation(connection, slide_id, annotation_id)
    values: dict[str, Any] = {}
    if edit.geometry is not None:
        if edit.geometry.type not in SHAPES[current.kind]:
            raise InvalidShapeError(f"A {current.kind} cannot be a {edit.geometry.type}")
        shape = edit.geometry.model_dump_json()
        await check_shapes(connection, [shape])
        values["geometry"] = func.ST_SetSRID(func.ST_GeomFromGeoJSON(shape), 0)
    if "class_id" in edit.model_fields_set:
        if edit.class_id is not None:
            await check_classes(connection, slide.project_id, {edit.class_id})
        values["class_id"] = edit.class_id
    return await bump(
        connection,
        principal,
        slide_id,
        annotation_id,
        edit.version,
        False,
        values,
        AnnotationChange.EDITED,
    )


@router.delete(
    "/{annotation_id}",
    operation_id="deleteAnnotation",
    status_code=204,
    **require(Permission.REVIEW, write=True),
)
async def delete_annotation(
    slide_id: uuid.UUID,
    annotation_id: uuid.UUID,
    version: Annotated[int, Query(ge=1)],
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Response:
    await drawable_slide(connection, principal, slide_id)
    await bump(
        connection,
        principal,
        slide_id,
        annotation_id,
        version,
        False,
        {"deleted_at": func.now()},
        AnnotationChange.DELETED,
    )
    return Response(status_code=204)


@router.post(
    "/{annotation_id}/restore",
    operation_id="restoreAnnotation",
    **require(Permission.REVIEW, write=True),
)
async def restore_annotation(
    slide_id: uuid.UUID,
    annotation_id: uuid.UUID,
    check: VersionCheck,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Annotation:
    await drawable_slide(connection, principal, slide_id)
    return await bump(
        connection,
        principal,
        slide_id,
        annotation_id,
        check.version,
        True,
        {"deleted_at": None},
        AnnotationChange.RESTORED,
    )


@router.get(
    "/{annotation_id}/history",
    operation_id="listAnnotationHistory",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def list_annotation_history(
    slide_id: uuid.UUID,
    annotation_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> list[AnnotationVersion]:
    await slide_row(connection, principal, slide_id)
    await one_annotation(connection, slide_id, annotation_id)
    rows = await connection.execute(
        select(
            annotation_versions.c.version,
            annotation_versions.c.change,
            func.ST_AsGeoJSON(annotation_versions.c.geometry).label("geojson"),
            annotation_versions.c.class_id,
            annotation_versions.c.changed_by_user_id,
            annotation_versions.c.changed_at,
        )
        .where(annotation_versions.c.annotation_id == annotation_id)
        .order_by(annotation_versions.c.version)
    )
    return [
        AnnotationVersion(
            version=row.version,
            change=AnnotationChange(row.change),
            geometry=json.loads(row.geojson),
            class_id=row.class_id,
            changed_by_user_id=row.changed_by_user_id,
            changed_at=row.changed_at,
        )
        for row in rows
    ]
