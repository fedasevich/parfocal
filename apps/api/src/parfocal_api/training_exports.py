import hashlib
import io
import json
import string
import uuid
import zipfile
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.adjudications import reviewers_of
from parfocal_api.annotation_exports import chunk_rows, path_of
from parfocal_api.annotations import LETTERS, PERSON_MADE_AI_KINDS
from parfocal_api.check_options import CheckOptions, UncheckedExport, check_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import ConflictError, ForbiddenError
from parfocal_api.review_order import Results
from parfocal_api.review_tasks import code_of, readable_task
from parfocal_api.reviewed_export import path_parts
from parfocal_api.tables import (
    AnnotationKind,
    AnnotationOrigin,
    annotation_versions,
    annotations,
    result_objects,
    result_set_classes,
    review_task_slides,
    slides,
)
from parfocal_api.task_kinds import annotate_only
from parfocal_api.taxonomy import ProjectClass
from parfocal_common.chunk_store import read_chunk
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.result_store import ResultStore

FORMAT = "parfocal-training-dataset"
FORMAT_VERSION = 1
MANIFEST = "manifest.json"
EXPORTED_KINDS = (AnnotationKind.ROI, AnnotationKind.REGION, AnnotationKind.CELL)
LEFT_OUT_KINDS = (AnnotationKind.MEASUREMENT, AnnotationKind.ARROW, AnnotationKind.TEXT)
AI_KINDS = {"region": AnnotationKind.REGION, "cell": AnnotationKind.CELL}
FEATURE_NAMESPACE = uuid.UUID("5b0f7c51-8f0e-4d55-9a57-3c1b2f6e9d10")


class DatasetOrigin(StrEnum):
    HUMAN = "human"
    AI_CONFIRMED = "ai-confirmed"
    AI_EDITED = "ai-edited"
    AI_UNCHECKED = "ai-unchecked"


class NothingSignedOffError(ConflictError):
    code = "nothing-signed-off"
    title = "Sign off at least one slide of this task before exporting the dataset"


class DatasetHiddenError(ForbiddenError):
    code = "dataset-hidden"
    title = "Only people who see the whole task export its dataset"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ManifestClass(Strict):
    id: uuid.UUID
    key: int
    name: str
    colour: str


class ManifestAnnotator(Strict):
    letter: str
    assigned: bool


class ManifestSignOff(Strict):
    signed_off_at: datetime
    signed_off_by: str | None


class ManifestFile(Strict):
    path: str
    sha256: str
    bytes: int


class ManifestSlide(Strict):
    slide_id: uuid.UUID
    file: ManifestFile
    mpp_x: float | None
    mpp_y: float | None
    width: int | None
    height: int | None
    result_set_id: uuid.UUID | None
    sign_off: ManifestSignOff
    annotators: list[str]
    objects: dict[DatasetOrigin, int]
    unchecked_left_out: int
    marks_left_out: int


class ManifestTask(Strict):
    id: uuid.UUID
    code: str


class Manifest(Strict):
    format: Literal["parfocal-training-dataset"]
    version: Literal[1]
    created_at: datetime
    task: ManifestTask
    coordinates: Literal["level-0-pixels"]
    kinds: list[AnnotationKind]
    origins: list[DatasetOrigin]
    classes: list[ManifestClass]
    check_options: CheckOptions
    annotators: list[ManifestAnnotator]
    slides: list[ManifestSlide]
    unchecked_left_out: int


@dataclass(frozen=True)
class Shape:
    feature_id: str
    kind: AnnotationKind
    object_id: ObjectId
    geometry: dict[str, Any]
    class_id: uuid.UUID | None
    class_name: str | None
    origin: DatasetOrigin
    author: str | None
    changed_by: str | None
    source: str | None


@dataclass(frozen=True)
class AiShape:
    kind: AnnotationKind
    object_id: ObjectId
    geometry: dict[str, Any]
    class_id: uuid.UUID | None
    class_name: str | None


router = APIRouter(prefix="/api/review-tasks/{task_id}/training-dataset", tags=["review-tasks"])


def letter_at(index: int) -> str:
    letters = string.ascii_uppercase
    word = letters[index % 26]
    while index >= 26:
        index = index // 26 - 1
        word = letters[index % 26] + word
    return word


def rgb_of(colour: str) -> list[int]:
    return [int(colour[i : i + 2], 16) for i in (1, 3, 5)]


class Letters:
    def __init__(self, assigned: list[uuid.UUID]) -> None:
        self.assigned = set(assigned)
        self.order: dict[uuid.UUID, str] = {}
        for person in assigned:
            self.of(person)

    def of(self, person: uuid.UUID | None) -> str | None:
        if person is None:
            return None
        if person not in self.order:
            self.order[person] = letter_at(len(self.order))
        return self.order[person]

    def listed(self) -> list[ManifestAnnotator]:
        return [
            ManifestAnnotator(letter=letter, assigned=person in self.assigned)
            for person, letter in self.order.items()
        ]


def qupath_feature(
    shape: Shape, where: tuple[str, str | None, str], classes: dict[uuid.UUID, ProjectClass]
) -> dict[str, Any]:
    found = classes.get(shape.class_id) if shape.class_id else None
    name = found.name if found else shape.class_name
    parfocal: dict[str, Any] = {
        "id": shape.object_id.text(ascii=True),
        "path": path_of(where, shape.object_id),
        "kind": shape.kind.value,
        "origin": shape.origin.value,
        "author": shape.author,
        "changed_by": shape.changed_by,
        "source": shape.source,
        "class_key": found.key if found else None,
    }
    classification = (
        {"name": name, "color": rgb_of(found.colour)} if found else {"name": name} if name else None
    )
    return {
        "type": "Feature",
        "id": shape.feature_id,
        "geometry": shape.geometry,
        "properties": {
            "objectType": "cell" if shape.kind is AnnotationKind.CELL else "annotation",
            "name": shape.object_id.text(ascii=True),
            "isLocked": True,
            **({"classification": classification} if classification else {}),
            "parfocal": parfocal,
        },
    }


async def ai_classes(
    connection: AsyncConnection, set_id: uuid.UUID
) -> dict[int, tuple[uuid.UUID | None, str]]:
    rows = await connection.execute(
        select(
            result_set_classes.c.position,
            result_set_classes.c.class_id,
            result_set_classes.c.source_name,
        ).where(result_set_classes.c.result_set_id == set_id)
    )
    return {row.position: (row.class_id, row.source_name) for row in rows}


async def ai_shapes(
    connection: AsyncConnection, store: ResultStore, set_id: uuid.UUID
) -> dict[tuple[AnnotationKind, int], AiShape]:
    classes = await ai_classes(connection, set_id)
    found: dict[tuple[AnnotationKind, int], AiShape] = {}
    rows = await connection.execute(
        select(
            result_objects.c.number,
            result_objects.c.class_index,
            func.ST_AsGeoJSON(result_objects.c.geometry).label("geojson"),
        )
        .where(result_objects.c.result_set_id == set_id, result_objects.c.kind == "region")
        .order_by(result_objects.c.number)
    )
    for row in rows:
        class_id, name = classes.get(row.class_index, (None, None))
        found[(AnnotationKind.REGION, row.number)] = AiShape(
            AnnotationKind.REGION,
            ObjectId(Letter.REGION, row.number),
            json.loads(row.geojson),
            class_id,
            name,
        )
    for chunk in await chunk_rows(connection, set_id):
        for cell in await read_chunk(store, chunk.object_key):
            points = [[cell.ring[i], cell.ring[i + 1]] for i in range(0, len(cell.ring), 2)]
            class_id, name = classes.get(cell.class_index, (None, None))
            found[(AnnotationKind.CELL, cell.number)] = AiShape(
                AnnotationKind.CELL,
                ObjectId(Letter.CELL, cell.number, region=cell.region or None),
                {"type": "Polygon", "coordinates": [[*points, points[0]]]},
                class_id,
                name,
            )
    return found


def origin_of(row: Any) -> DatasetOrigin | None:
    if row.deleted_at is not None:
        return None
    return DatasetOrigin(row.origin)


@dataclass(frozen=True)
class SlideObjects:
    shapes: list[Shape]
    left_out: int
    marks: int


async def slide_objects(
    connection: AsyncConnection,
    store: ResultStore,
    slide: Any,
    letters: Letters,
    unchecked: UncheckedExport,
) -> SlideObjects:
    rows = (
        await connection.execute(
            select(
                annotations.c.id,
                annotations.c.kind,
                annotations.c.number,
                annotations.c.origin,
                annotations.c.source_number,
                annotations.c.class_id,
                annotations.c.created_by_user_id,
                annotations.c.deleted_at,
                func.ST_AsGeoJSON(annotations.c.geometry).label("geojson"),
            )
            .where(annotations.c.task_id == slide.task_id, annotations.c.slide_id == slide.slide_id)
            .order_by(annotations.c.kind, annotations.c.number)
        )
    ).all()
    changers = await last_changers(connection, [row.id for row in rows])
    ai = (
        {}
        if slide.result_set_id is None
        else await ai_shapes(connection, store, slide.result_set_id)
    )
    shapes: list[Shape] = []
    covered: set[tuple[AnnotationKind, int]] = set()
    marks = 0
    for row in rows:
        kind = AnnotationKind(row.kind)
        origin = origin_of(row)
        if row.source_number is not None and (
            origin is not None or row.origin == AnnotationOrigin.AI_EDITED
        ):
            covered.add((kind, row.source_number))
        if origin is None:
            continue
        if kind not in EXPORTED_KINDS:
            marks += 1
            continue
        source = ai.get((kind, row.source_number)) if row.source_number is not None else None
        shapes.append(
            Shape(
                str(row.id),
                kind,
                ObjectId(LETTERS[kind], row.number, person=kind in PERSON_MADE_AI_KINDS),
                json.loads(row.geojson),
                row.class_id or (source.class_id if source else None),
                None if row.class_id or source is None else source.class_name,
                origin,
                letters.of(row.created_by_user_id),
                letters.of(changers.get(row.id)),
                None
                if row.source_number is None
                else ObjectId(LETTERS[kind], row.source_number).text(ascii=True),
            )
        )
    left_out = 0
    for key, item in ai.items():
        if key in covered:
            continue
        if unchecked is UncheckedExport.LEAVE_OUT:
            left_out += 1
            continue
        shapes.append(
            Shape(
                str(uuid.uuid5(FEATURE_NAMESPACE, f"{slide.slide_id}/{item.object_id.text()}")),
                item.kind,
                item.object_id,
                item.geometry,
                item.class_id,
                item.class_name,
                DatasetOrigin.AI_UNCHECKED,
                None,
                None,
                None,
            )
        )
    return SlideObjects(shapes, left_out, marks)


async def last_changers(
    connection: AsyncConnection, ids: list[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    if not ids:
        return {}
    rows = await connection.execute(
        select(annotation_versions.c.annotation_id, annotation_versions.c.changed_by_user_id)
        .where(annotation_versions.c.annotation_id.in_(ids))
        .order_by(annotation_versions.c.annotation_id, annotation_versions.c.version)
    )
    return {row.annotation_id: row.changed_by_user_id for row in rows if row.changed_by_user_id}


async def signed_off_slides(connection: AsyncConnection, task_id: uuid.UUID) -> list[Any]:
    rows = await connection.execute(
        select(
            review_task_slides.c.task_id,
            review_task_slides.c.slide_id,
            review_task_slides.c.result_set_id,
            review_task_slides.c.signed_off_at,
            review_task_slides.c.signed_off_by_user_id,
            slides.c.mpp_x,
            slides.c.mpp_y,
            slides.c.width,
            slides.c.height,
        )
        .join(slides, slides.c.id == review_task_slides.c.slide_id)
        .where(
            review_task_slides.c.task_id == task_id,
            review_task_slides.c.signed_off_at.is_not(None),
        )
        .order_by(review_task_slides.c.position)
    )
    return list(rows)


def encoded(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


async def dataset(
    connection: AsyncConnection, task: Any, store: ResultStore
) -> tuple[Manifest, dict[str, bytes]]:
    signed = await signed_off_slides(connection, task.id)
    if not signed:
        raise NothingSignedOffError
    options = check_of(task.check_options)
    stored: list[Any] = list(task.class_snapshot or [])
    snapshot = [ProjectClass.model_validate(item) for item in stored]
    classes = {item.id: item for item in snapshot}
    letters = Letters(await reviewers_of(connection, task.id))
    files: dict[str, bytes] = {}
    entries: list[ManifestSlide] = []
    for slide in signed:
        found = await slide_objects(connection, store, slide, letters, options.unchecked_export)
        where = await path_parts(connection, slide.slide_id)
        content = encoded(
            {
                "type": "FeatureCollection",
                "features": [qupath_feature(shape, where, classes) for shape in found.shapes],
            }
        )
        path = f"slides/{slide.slide_id}.geojson"
        files[path] = content
        counts = Counter(shape.origin for shape in found.shapes)
        authors = {shape.author for shape in found.shapes} | {
            shape.changed_by for shape in found.shapes
        }
        entries.append(
            ManifestSlide(
                slide_id=slide.slide_id,
                file=ManifestFile(
                    path=path, sha256=hashlib.sha256(content).hexdigest(), bytes=len(content)
                ),
                mpp_x=slide.mpp_x,
                mpp_y=slide.mpp_y,
                width=slide.width,
                height=slide.height,
                result_set_id=slide.result_set_id,
                sign_off=ManifestSignOff(
                    signed_off_at=slide.signed_off_at,
                    signed_off_by=letters.of(slide.signed_off_by_user_id),
                ),
                annotators=sorted(
                    (author for author in authors if author is not None),
                    key=lambda letter: (len(letter), letter),
                ),
                objects={origin: counts[origin] for origin in DatasetOrigin},
                unchecked_left_out=found.left_out,
                marks_left_out=found.marks,
            )
        )
    manifest = Manifest(
        format=FORMAT,
        version=FORMAT_VERSION,
        created_at=datetime.now(UTC),
        task=ManifestTask(id=task.id, code=code_of(task.number)),
        coordinates="level-0-pixels",
        kinds=list(EXPORTED_KINDS),
        origins=[
            origin
            for origin in DatasetOrigin
            if origin is not DatasetOrigin.AI_UNCHECKED
            or options.unchecked_export is UncheckedExport.INCLUDE
        ],
        classes=[ManifestClass.model_validate(item.model_dump()) for item in snapshot],
        check_options=options,
        annotators=letters.listed(),
        slides=entries,
        unchecked_left_out=sum(entry.unchecked_left_out for entry in entries),
    )
    return manifest, files


def zipped(manifest: Manifest, files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(MANIFEST, manifest.model_dump_json(indent=2))
        for path, content in files.items():
            archive.writestr(path, content)
    return buffer.getvalue()


@router.get(
    "",
    operation_id="exportTrainingDataset",
    response_class=Response,
    responses={
        200: {
            "description": "A zip of one QuPath GeoJSON file per signed-off slide and a manifest",
            "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def export_training_dataset(
    task_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> Response:
    task, whole = await readable_task(connection, principal, task_id)
    annotate_only(task.kind)
    if not whole:
        raise DatasetHiddenError
    manifest, files = await dataset(connection, task, results)
    return Response(
        zipped(manifest, files),
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="parfocal-{code_of(task.number)}-dataset.zip"'
            ),
            "X-Content-Type-Options": "nosniff",
        },
    )
