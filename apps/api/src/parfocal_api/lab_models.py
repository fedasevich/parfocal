import uuid
from collections import Counter
from datetime import datetime
from typing import Annotated, Any, Literal

import httpx2
from fastapi import APIRouter, Path, Request
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import func, insert, select
from sqlalchemy.engine import Row
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import user_of
from parfocal_api.cases import keyring_of
from parfocal_api.class_templates import TEMPLATES, TaxonomyTemplate
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.identifiers import ensure_keys, load_keys, open_field, seal_field
from parfocal_api.model_catalogue import ModelVersion
from parfocal_api.permissions import Permission, member_of, require
from parfocal_api.principals import Principal, database_scope
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.tables import (
    LabModelRunners,
    LabModelSignIn,
    lab_model_projects,
    lab_models,
    projects,
)
from parfocal_api.uploads import Settings
from parfocal_common.lab_model_call import (
    CALL_FAILURES,
    LINK_TO_CALL,
    SAMPLE_ORIGIN,
    SAMPLE_SLIDE,
    Answer,
    CallRefusal,
    CallRefusedError,
    Endpoint,
    SignIn,
    call_endpoint,
)
from parfocal_common.link_fetch import LinkRefusedError, policy_of, target_of

TABLE = "lab_models"
SECRET_FIELD = "secret"
OUTLINE_WIDTH = 272
OUTLINE_HEIGHT = 196
MAX_CLASSES = 64

type Address = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2048)
]
type Secret = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4096)
]
type HeaderName = Annotated[
    str,
    StringConstraints(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9-]*$"),
]
type LabModelName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
type SentName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
type TileSize = Literal[256, 512, 1024]
type Magnification = Literal[10, 20, 40]
type ModelId = Annotated[uuid.UUID, Path()]

router = APIRouter(prefix="/api/tenant/models", tags=["tenant"])

SUGGESTIONS: dict[TaxonomyTemplate, dict[str, str]] = {
    TaxonomyTemplate.SENTINEL_NODE: {
        "neoplastic": "Tumor",
        "tumor": "Tumor",
        "tumour": "Tumor",
        "inflammatory": "Immune",
        "immune": "Immune",
        "lymphocyte": "Immune",
        "connective": "Stroma",
        "stroma": "Stroma",
        "epithelial": "Other",
    },
    TaxonomyTemplate.PANNUKE: {},
}


class LabModelRefusedError(BadRequestError):
    code = "lab-model-refused"
    title = "Parfocal will not call this server"


class LabModelSecretMissingError(BadRequestError):
    code = "lab-model-secret-missing"
    title = "Give the token or header this server needs"


class LabModelClassUnknownError(BadRequestError):
    code = "lab-model-class-unknown"
    title = "A class in the map is not in the chosen taxonomy"


class LabModelProjectNotFoundError(BadRequestError):
    code = "lab-model-project-not-found"
    title = "A chosen project is not in this workspace"


class LabModelExistsError(ConflictError):
    code = "lab-model-exists"
    title = "A model with this name and version is already connected"


class LabModelNotFoundError(NotFoundError):
    code = "lab-model-not-found"
    title = "No connected model has this ID"


class ServerSignIn(BaseModel):
    address: Address
    sign_in: LabModelSignIn
    header_name: HeaderName | None = None
    secret: Secret | None = None
    tile_size: TileSize = 512
    magnification: Magnification = 40


class LabModelTestRequest(ServerSignIn):
    taxonomy: TaxonomyTemplate = TaxonomyTemplate.SENTINEL_NODE


class ClassMatch(BaseModel):
    sent: SentName
    becomes: str | None


class LabModelDraft(ServerSignIn):
    name: LabModelName
    version: ModelVersion
    taxonomy: TaxonomyTemplate
    class_map: list[ClassMatch] = Field(max_length=MAX_CLASSES)
    who_can_run: LabModelRunners
    project_ids: list[uuid.UUID] = Field(max_length=200)

    @model_validator(mode="after")
    def sent_once(self) -> LabModelDraft:
        sent = [match.sent.casefold() for match in self.class_map]
        if len(sent) != len(set(sent)):
            raise ValueError("each sent class appears once in the class map")
        return self


class ModelOfTest(BaseModel):
    name: str
    version: str


class SentClass(BaseModel):
    name: str
    cells: int
    suggested: str | None


class OutlineCell(BaseModel):
    x: float
    y: float
    rx: float
    ry: float
    class_: str = Field(alias="class", serialization_alias="class")


class TileOutline(BaseModel):
    regions: list[list[tuple[float, float]]]
    cells: list[OutlineCell]


class SampleTile(BaseModel):
    label: str
    slide: str
    answered_ms: int
    regions: int
    cells: int
    classes: int
    outline: TileOutline


class LabModelTest(BaseModel):
    outcome: Literal["follows-contract", "not-contract"]
    sample_slide: str
    returns: list[str]
    answered_ms: int
    server_software: str | None
    tiles: list[SampleTile]
    missing_geometry: int
    model: ModelOfTest | None
    classes: list[SentClass]


class LabModel(BaseModel):
    id: uuid.UUID
    name: str
    version: str
    address: str
    host: str
    sign_in: LabModelSignIn
    header_name: str | None
    last_four: str | None
    tile_size: int
    magnification: int
    taxonomy: TaxonomyTemplate
    class_map: list[ClassMatch]
    who_can_run: LabModelRunners
    project_ids: list[uuid.UUID]
    created_at: datetime


def host_of(address: str) -> str:
    rest = address.split("://", 1)[-1]
    return rest.split("/", 1)[0].rsplit("@", 1)[-1]


def endpoint_of(draft: ServerSignIn, secret: str | None) -> Endpoint:
    if draft.sign_in is not LabModelSignIn.NONE and not secret:
        raise LabModelSecretMissingError
    return Endpoint(
        draft.address,
        SignIn(draft.sign_in),
        secret if draft.sign_in is not LabModelSignIn.NONE else None,
        draft.header_name,
    )


async def called(settings: Settings, endpoint: Endpoint, draft: ServerSignIn) -> Answer:
    try:
        return await call_endpoint(
            endpoint,
            policy_of(settings.link_trusted_origins),
            settings.link_read_seconds,
            draft.tile_size,
            draft.magnification,
        )
    except CallRefusedError as error:
        raise LabModelRefusedError(CALL_FAILURES[error.code]) from error


async def check_address(settings: Settings, draft: ServerSignIn) -> None:
    try:
        await target_of(httpx2.URL(draft.address), policy_of(settings.link_trusted_origins))
    except httpx2.InvalidURL as error:
        raise LabModelRefusedError(CALL_FAILURES[CallRefusal.SCHEME]) from error
    except LinkRefusedError as error:
        code = LINK_TO_CALL.get(error.code, CallRefusal.UNREACHABLE)
        raise LabModelRefusedError(CALL_FAILURES[code]) from error


def suggestion(taxonomy: TaxonomyTemplate, name: str) -> str | None:
    names = {known.casefold(): known for known, _ in TEMPLATES[taxonomy]}
    folded = name.casefold()
    return names.get(folded) or SUGGESTIONS[taxonomy].get(folded)


def outline_of(answer: Answer, tile_size: int) -> TileOutline:
    origin_x, origin_y = SAMPLE_ORIGIN
    scale_x, scale_y = OUTLINE_WIDTH / tile_size, OUTLINE_HEIGHT / tile_size

    def placed(point: tuple[float, float]) -> tuple[float, float]:
        return (
            round((point[0] - origin_x) * scale_x, 1),
            round((point[1] - origin_y) * scale_y, 1),
        )

    regions: list[list[tuple[float, float]]] = []
    cells: list[OutlineCell] = []
    for item in answer.objects:
        ring = [placed(point) for point in item.ring]
        if item.kind == "region":
            regions.append(ring)
            continue
        xs, ys = [x for x, _ in ring], [y for _, y in ring]
        cells.append(
            OutlineCell.model_validate(
                {
                    "x": round((min(xs) + max(xs)) / 2, 1),
                    "y": round((min(ys) + max(ys)) / 2, 1),
                    "rx": round(max(1.0, (max(xs) - min(xs)) / 2), 1),
                    "ry": round(max(1.0, (max(ys) - min(ys)) / 2), 1),
                    "class": item.name,
                }
            )
        )
    return TileOutline(regions=regions, cells=cells)


def test_of(answer: Answer, request: LabModelTestRequest) -> LabModelTest:
    model = (
        ModelOfTest(name=answer.model_name, version=answer.model_version)
        if answer.model_name and answer.model_version
        else None
    )
    counted = Counter(item.name for item in answer.objects)
    kinds = {item.kind for item in answer.objects}
    returns = [label for kind, label in (("region", "Regions"), ("cell", "Cells")) if kind in kinds]
    tiles: list[SampleTile] = []
    if answer.follows_contract:
        tiles.append(
            SampleTile(
                label="Sample tile",
                slide=SAMPLE_SLIDE,
                answered_ms=answer.answered_ms,
                regions=sum(1 for item in answer.objects if item.kind == "region"),
                cells=sum(1 for item in answer.objects if item.kind == "cell"),
                classes=len(counted),
                outline=outline_of(answer, request.tile_size),
            )
        )
    return LabModelTest(
        outcome="follows-contract" if answer.follows_contract else "not-contract",
        sample_slide=SAMPLE_SLIDE,
        returns=returns,
        answered_ms=answer.answered_ms,
        server_software=answer.server_software,
        tiles=tiles,
        missing_geometry=answer.missing_geometry,
        model=model,
        classes=[
            SentClass(name=name, cells=cells, suggested=suggestion(request.taxonomy, name))
            for name, cells in sorted(counted.items(), key=lambda pair: (-pair[1], pair[0]))
        ][:MAX_CLASSES],
    )


async def audited(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    model_id: uuid.UUID | None,
    details: dict[str, Any],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.LAB_MODEL,
        model_id,
        tenant_id=database_scope(principal).tenant_id,
        details=details,
    )


def check_class_map(draft: LabModelDraft) -> None:
    known = {name for name, _ in TEMPLATES[draft.taxonomy]}
    unknown = sorted(
        match.becomes for match in draft.class_map if match.becomes and match.becomes not in known
    )
    if unknown:
        raise LabModelClassUnknownError(f"{', '.join(unknown)} is not a {draft.taxonomy} class")


async def check_projects(connection: AsyncConnection, ids: list[uuid.UUID]) -> list[uuid.UUID]:
    chosen = sorted(set(ids))
    if not chosen:
        return []
    found = await connection.scalar(
        select(func.count()).select_from(projects).where(projects.c.id.in_(chosen))
    )
    if found != len(chosen):
        raise LabModelProjectNotFoundError
    return chosen


async def project_ids_of(connection: AsyncConnection, model_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await connection.scalars(
        select(lab_model_projects.c.project_id)
        .where(lab_model_projects.c.lab_model_id == model_id)
        .order_by(lab_model_projects.c.project_id)
    )
    return list(rows)


async def model_row(connection: AsyncConnection, model_id: uuid.UUID) -> Row[Any]:
    row = (await connection.execute(select(lab_models).where(lab_models.c.id == model_id))).first()
    if row is None:
        raise LabModelNotFoundError
    return row


async def lab_model_of(connection: AsyncConnection, row: Row[Any]) -> LabModel:
    return LabModel(
        id=row.id,
        name=row.name,
        version=row.version,
        address=row.address,
        host=host_of(row.address),
        sign_in=LabModelSignIn(row.sign_in),
        header_name=row.header_name,
        last_four=row.secret_last_four,
        tile_size=row.tile_size,
        magnification=row.magnification,
        taxonomy=TaxonomyTemplate(row.taxonomy),
        class_map=[ClassMatch.model_validate(match) for match in row.class_map],
        who_can_run=LabModelRunners(row.who_can_run),
        project_ids=await project_ids_of(connection, row.id),
        created_at=row.created_at,
    )


@router.post(
    "/test",
    operation_id="testLabModel",
    **require(Permission.INTEGRATIONS, write=True),
)
async def test_lab_model(
    body: LabModelTestRequest,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
) -> LabModelTest:
    answer = await called(settings, endpoint_of(body, body.secret), body)
    result = test_of(answer, body)
    await audited(
        connection,
        principal,
        AuditAction.LAB_MODEL_TESTED,
        None,
        {"host": host_of(body.address), "outcome": result.outcome},
    )
    return result


@router.post(
    "",
    operation_id="connectLabModel",
    status_code=201,
    **require(Permission.INTEGRATIONS, write=True),
)
async def connect_lab_model(
    draft: LabModelDraft,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
) -> LabModel:
    endpoint = endpoint_of(draft, draft.secret)
    await check_address(settings, draft)
    check_class_map(draft)
    chosen = await check_projects(connection, draft.project_ids)
    tenant_id = database_scope(principal).tenant_id
    model_id = uuid.uuid4()
    sealed = None
    if endpoint.secret is not None:
        keys = await ensure_keys(connection, keyring_of(request), member_of(principal).tenant_id)
        sealed = seal_field(keys, TABLE, model_id, SECRET_FIELD, endpoint.secret)
    try:
        async with connection.begin_nested():
            await connection.execute(
                insert(lab_models).values(
                    id=model_id,
                    tenant_id=tenant_id,
                    name=draft.name,
                    version=draft.version,
                    address=draft.address,
                    sign_in=draft.sign_in,
                    header_name=draft.header_name
                    if draft.sign_in is LabModelSignIn.HEADER
                    else None,
                    secret_ciphertext=sealed,
                    secret_last_four=endpoint.secret[-4:] if endpoint.secret else None,
                    tile_size=draft.tile_size,
                    magnification=draft.magnification,
                    taxonomy=draft.taxonomy,
                    class_map=[match.model_dump() for match in draft.class_map],
                    who_can_run=draft.who_can_run,
                    created_by_user_id=user_of(principal),
                )
            )
    except IntegrityError as error:
        raise LabModelExistsError from error
    if chosen:
        await connection.execute(
            insert(lab_model_projects),
            [
                {"lab_model_id": model_id, "project_id": project_id, "tenant_id": tenant_id}
                for project_id in chosen
            ],
        )
    await audited(
        connection,
        principal,
        AuditAction.LAB_MODEL_CONNECTED,
        model_id,
        {
            "name": draft.name,
            "version": draft.version,
            "host": host_of(draft.address),
            "projects": [str(project_id) for project_id in chosen],
        },
    )
    return await lab_model_of(connection, await model_row(connection, model_id))


@router.get(
    "/{model_id}",
    operation_id="getLabModel",
    **require(Permission.INTEGRATIONS),
)
async def get_lab_model(model_id: ModelId, connection: TenantConnection) -> LabModel:
    return await lab_model_of(connection, await model_row(connection, model_id))


@router.post(
    "/{model_id}/test",
    operation_id="testConnectedLabModel",
    **require(Permission.INTEGRATIONS, write=True),
)
async def test_connected_lab_model(
    model_id: ModelId,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    settings: Settings,
) -> LabModelTest:
    row = await model_row(connection, model_id)
    secret = None
    if row.secret_ciphertext is not None:
        keys = await load_keys(connection, keyring_of(request), member_of(principal).tenant_id)
        secret = open_field(keys, TABLE, row.id, SECRET_FIELD, row.secret_ciphertext)
    body = LabModelTestRequest(
        address=row.address,
        sign_in=LabModelSignIn(row.sign_in),
        header_name=row.header_name,
        secret=secret,
        tile_size=row.tile_size,
        magnification=row.magnification,
        taxonomy=TaxonomyTemplate(row.taxonomy),
    )
    result = test_of(await called(settings, endpoint_of(body, secret), body), body)
    await audited(
        connection,
        principal,
        AuditAction.LAB_MODEL_TESTED,
        model_id,
        {"host": host_of(row.address), "outcome": result.outcome},
    )
    return result
