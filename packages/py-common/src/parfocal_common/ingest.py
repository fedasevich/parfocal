import uuid
from collections.abc import Mapping
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.jobs import Step, StepRun, Workflow, enqueue

KIND = "ingest"
STEP_NAMES = ("quarantine", "identify", "scan", "validate", "index", "derive", "publish")
LEASE_SECONDS = 60.0
ORIGINAL_SUFFIXES = frozenset(
    {
        ".svs",
        ".tif",
        ".tiff",
        ".ndpi",
        ".scn",
        ".bif",
        ".avs",
        ".dcm",
        ".zip",
    }
)


class Refusal(StrEnum):
    EMPTY = "empty"
    MULTI_FILE = "multi-file"
    ZEISS_CZI = "zeiss-czi"
    ZEISS_ZVI = "zeiss-zvi"
    PHILIPS_ISYNTAX = "philips-isyntax"
    PLAIN_IMAGE = "plain-image"
    DAMAGED_TIFF = "damaged-tiff"
    ARCHIVE_WITHOUT_SLIDE = "archive-without-slide"
    MULTI_REGION = "multi-region"
    TRUNCATED = "truncated"
    DAMAGED_ARCHIVE = "damaged-archive"
    NO_PYRAMID = "no-pyramid"
    UNREADABLE = "unreadable"
    UNKNOWN = "unknown"


REASONS = {
    Refusal.EMPTY: "The file is empty.",
    Refusal.MULTI_FILE: (
        "This slide is made of several files. Put the whole slide folder in one .zip and upload "
        "that."
    ),
    Refusal.ZEISS_CZI: "Zeiss CZI files are not supported. Export the slide as OME-TIFF.",
    Refusal.ZEISS_ZVI: "Zeiss ZVI files are not supported. Export the slide as OME-TIFF.",
    Refusal.PHILIPS_ISYNTAX: (
        "Philips iSyntax is a closed format. Export the slide from the Philips system as TIFF."
    ),
    Refusal.PLAIN_IMAGE: "This is an ordinary picture, not a whole slide image.",
    Refusal.DAMAGED_TIFF: "The file looks like a TIFF but cannot be read. It may be damaged.",
    Refusal.ARCHIVE_WITHOUT_SLIDE: "The .zip holds no slide that Parfocal can read.",
    Refusal.MULTI_REGION: (
        "This Leica file holds several separately scanned regions. Export each region as its own "
        "slide."
    ),
    Refusal.NO_PYRAMID: "The file holds no image large enough to be a whole slide.",
    Refusal.TRUNCATED: (
        "The file is cut short, so parts of the slide are missing. Upload it again."
    ),
    Refusal.DAMAGED_ARCHIVE: (
        "A file inside the .zip is damaged. Make the .zip again and upload it."
    ),
    Refusal.UNREADABLE: (
        "Parfocal recognises this format but cannot read the pixels of this file. It may be "
        "damaged or written by a scanner version that is not supported yet."
    ),
    Refusal.UNKNOWN: "Parfocal does not recognise this file as a whole slide image.",
}


class Notice(StrEnum):
    MPP_ESTIMATED = "mpp-estimated"
    MPP_MISSING = "mpp-missing"
    OBJECTIVE_ESTIMATED = "objective-estimated"
    OBJECTIVE_MISSING = "objective-missing"
    LEVEL_SKIPPED = "level-skipped"
    FIRST_PLANE_ONLY = "first-plane-only"


NOTICES = {
    Notice.MPP_ESTIMATED: (
        "The file does not say how large a pixel is. Parfocal estimated it from the objective "
        "power, so measurements are approximate."
    ),
    Notice.MPP_MISSING: (
        "The file does not say how large a pixel is, so measurements in microns are not available."
    ),
    Notice.OBJECTIVE_ESTIMATED: (
        "The file does not name the objective power. Parfocal estimated it from the pixel size."
    ),
    Notice.OBJECTIVE_MISSING: "The file does not name the objective power.",
    Notice.LEVEL_SKIPPED: (
        "A stored resolution level does not halve the one above it and is not used."
    ),
    Notice.FIRST_PLANE_ONLY: "The slide has several focal planes. Only the first is shown.",
}


class Failure(StrEnum):
    UPLOAD_MISSING = "upload-missing"
    SIZE_MISMATCH = "size-mismatch"
    UPLOAD_ABORTED = "upload-aborted"
    UPLOAD_EXPIRED = "upload-expired"


FAILURES: Mapping[str, str] = {
    **{refusal.value: text for refusal, text in REASONS.items()},
    Failure.UPLOAD_MISSING: "The uploaded file is no longer in storage. Upload it again.",
    Failure.SIZE_MISMATCH: (
        "The stored file is not the size the upload announced, so parts are missing. Upload it "
        "again."
    ),
    Failure.UPLOAD_ABORTED: "The upload was cancelled before it finished.",
    Failure.UPLOAD_EXPIRED: (
        "The upload stopped for more than a day and was cancelled. Start it again."
    ),
}
GENERIC_FAILURE = "Parfocal could not take this file in."


def failure_message(code: str) -> str:
    return FAILURES.get(code, GENERIC_FAILURE)


def original_suffix(name: str) -> str:
    suffix = PurePosixPath(name).suffix.lower()
    return suffix if suffix in ORIGINAL_SUFFIXES else ""


def slide_prefix(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> str:
    return f"t/{tenant_id}/s/{slide_id}/"


def restricted_prefix(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> str:
    return f"t/{tenant_id}/restricted/{slide_id}/"


def original_key(tenant_id: uuid.UUID, slide_id: uuid.UUID, name: str) -> str:
    return f"{slide_prefix(tenant_id, slide_id)}original{original_suffix(name)}"


class RunsInTheIngestWorkerError(RuntimeError):
    pass


async def runs_in_the_ingest_worker(step: StepRun) -> Mapping[str, Any]:
    raise RunsInTheIngestWorkerError(step.job_id)


PLAN = Workflow(
    kind=KIND,
    steps=[Step(name, runs_in_the_ingest_worker) for name in STEP_NAMES],
    lease_seconds=LEASE_SECONDS,
)


def job_input(upload_id: uuid.UUID) -> dict[str, str]:
    return {"upload_id": str(upload_id)}


async def enqueue_ingest(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    upload_id: uuid.UUID,
) -> uuid.UUID:
    return await enqueue(connection, PLAN, tenant_id, project_id, job_input(upload_id))
