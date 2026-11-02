import uuid
from collections.abc import Mapping
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.jobs import Step, StepRun, Workflow, enqueue

KIND = "result-import"
STEP_NAMES = ("import",)
LEASE_SECONDS = 60.0
RESULT_SET_IDS = uuid.UUID("5d1f0b52-7a43-4c39-9a0e-2f4d8c6b1e70")
SOURCE_SUFFIXES = frozenset({".geojson", ".json", ".csv", ".tsv"})


class UploadKind(StrEnum):
    SLIDE = "slide"
    RESULT = "result"


class ResultFormat(StrEnum):
    GEOJSON = "geojson"
    PARFOCAL_JSON = "parfocal-json"
    CSV = "csv"
    HEATMAP = "heatmap"


FORMAT_SUFFIXES: Mapping[str, ResultFormat] = {
    ".geojson": ResultFormat.GEOJSON,
    ".csv": ResultFormat.CSV,
    ".tsv": ResultFormat.CSV,
    ".png": ResultFormat.HEATMAP,
    ".tif": ResultFormat.HEATMAP,
    ".tiff": ResultFormat.HEATMAP,
}
SNIFFED_SUFFIXES = frozenset({".json"})


def format_of(name: str) -> ResultFormat | None:
    return FORMAT_SUFFIXES.get(PurePosixPath(name.replace("\\", "/")).suffix.lower())


def can_sniff(name: str) -> bool:
    return PurePosixPath(name.replace("\\", "/")).suffix.lower() in SNIFFED_SUFFIXES


class ImportFailure(StrEnum):
    UNREADABLE = "result-unreadable"
    EMPTY = "result-empty"
    COLUMNS_UNMAPPED = "result-columns-unmapped"
    TOO_MANY_CLASSES = "result-too-many-classes"
    SLIDE_MISSING = "result-slide-missing"
    OUTSIDE_SLIDE = "result-outside-slide"
    HEATMAP_NOT_STORED = "result-heatmap-not-stored"


IMPORT_FAILURES: Mapping[str, str] = {
    ImportFailure.UNREADABLE: (
        "Parfocal could not read this result file. Check that it is GeoJSON, Parfocal JSON or a "
        "CSV of cells."
    ),
    ImportFailure.EMPTY: "The result file holds no objects that Parfocal can read.",
    ImportFailure.COLUMNS_UNMAPPED: (
        "Parfocal could not find the x and y columns or a polygon column in this table."
    ),
    ImportFailure.TOO_MANY_CLASSES: "The result file names more than 255 classes.",
    ImportFailure.SLIDE_MISSING: (
        "The slide this result belongs to was deleted before the result was imported."
    ),
    ImportFailure.OUTSIDE_SLIDE: (
        "Every object in this result file lies outside its slide, so nothing was imported."
    ),
    ImportFailure.HEATMAP_NOT_STORED: (
        "Parfocal checked this heatmap against its slide but cannot keep heatmaps yet."
    ),
}


class Waiting(StrEnum):
    NEEDS_SLIDE = "needs-slide"
    WAITING_FOR_SLIDE = "waiting-for-slide"
    SLIDE_REFUSED = "slide-refused"
    NEEDS_CHOICES = "needs-choices"


WAITING: Mapping[str, str] = {
    Waiting.NEEDS_SLIDE: "This result matches no slide yet. Pick its slide.",
    Waiting.WAITING_FOR_SLIDE: "This result is imported once its slide is ready.",
    Waiting.SLIDE_REFUSED: (
        "The slide this result belongs to could not be taken in. Pick another slide."
    ),
    Waiting.NEEDS_CHOICES: "Parfocal found problems in this result. Choose how to import it.",
}


class CheckProblem(StrEnum):
    UNREADABLE_OBJECTS = "objects-unreadable"
    OBJECTS_WITHOUT_CLASS = "objects-without-class"
    UNKNOWN_CLASSES = "classes-unknown"
    SCORES_MISSING = "scores-missing"
    PARTLY_OUTSIDE = "objects-outside-slide"
    HEATMAP_SCALE = "heatmap-scale"


CHECK_PROBLEMS: Mapping[str, str] = {
    CheckProblem.UNREADABLE_OBJECTS: "These objects could not be read.",
    CheckProblem.OBJECTS_WITHOUT_CLASS: "These objects have no class.",
    CheckProblem.UNKNOWN_CLASSES: "These classes are not in the project yet. Map them once.",
    CheckProblem.SCORES_MISSING: "These objects have no score. Count them as no score or as 1.0.",
    CheckProblem.PARTLY_OUTSIDE: "These objects lie outside the slide.",
    CheckProblem.HEATMAP_SCALE: "Parfocal guessed the slide level and scale of this heatmap.",
}


class ScoreDefault(StrEnum):
    NONE = "none"
    ONE = "one"


class ImportNotice(StrEnum):
    PROBABILITIES_DROPPED = "cell-probabilities-dropped"
    OBJECTS_SKIPPED = "objects-skipped"


IMPORT_NOTICES: Mapping[str, str] = {
    ImportNotice.PROBABILITIES_DROPPED: (
        "Only some cells in the file have class probabilities, so Parfocal kept the probabilities "
        "of none of them."
    ),
    ImportNotice.OBJECTS_SKIPPED: "Some objects in the file could not be read and were left out.",
}


def result_set_id_for(upload_id: uuid.UUID) -> uuid.UUID:
    return uuid.uuid5(RESULT_SET_IDS, str(upload_id))


def source_suffix(name: str) -> str:
    suffix = PurePosixPath(name).suffix.lower()
    return suffix if suffix in SOURCE_SUFFIXES else ""


def result_set_prefix(tenant_id: uuid.UUID, slide_id: uuid.UUID, set_id: uuid.UUID) -> str:
    return f"t/{tenant_id}/s/{slide_id}/results/{set_id}/"


def source_key(tenant_id: uuid.UUID, slide_id: uuid.UUID, set_id: uuid.UUID, name: str) -> str:
    return f"{result_set_prefix(tenant_id, slide_id, set_id)}source{source_suffix(name)}"


class RunsInTheIngestWorkerError(RuntimeError):
    pass


async def runs_in_the_ingest_worker(step: StepRun) -> Mapping[str, Any]:
    raise RunsInTheIngestWorkerError(step.job_id)


PLAN = Workflow(
    kind=KIND,
    steps=[Step(name, runs_in_the_ingest_worker) for name in STEP_NAMES],
    lease_seconds=LEASE_SECONDS,
)


async def enqueue_result_import(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    upload_id: uuid.UUID,
) -> uuid.UUID:
    return await enqueue(connection, PLAN, tenant_id, project_id, {"upload_id": str(upload_id)})
