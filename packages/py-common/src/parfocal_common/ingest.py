import re
import uuid
from collections.abc import Mapping
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.jobs import Step, StepRun, Workflow, enqueue
from parfocal_common.link_imports import LINK_IMPORT_FAILURES
from parfocal_common.result_imports import IMPORT_FAILURES

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
    SEVERAL_SCAN_AREAS = "several-scan-areas"
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
    Refusal.SEVERAL_SCAN_AREAS: (
        "This slide holds several scan areas, which Parfocal cannot place yet."
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
    HIGH_POWER_UNREADABLE = "high-power-unreadable"


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
    Notice.FIRST_PLANE_ONLY: "The slide has several focal planes. Only the one in focus is shown.",
    Notice.HIGH_POWER_UNREADABLE: (
        "The slide cannot be read at the highest magnifications. Lower magnifications still show."
    ),
}


class Failure(StrEnum):
    UPLOAD_MISSING = "upload-missing"
    SIZE_MISMATCH = "size-mismatch"
    UPLOAD_ABORTED = "upload-aborted"
    UPLOAD_EXPIRED = "upload-expired"
    CHECK_STOPPED = "check-stopped"
    PARSE_TOO_LARGE = "parse-too-large"
    PARSE_TOO_SLOW = "parse-too-slow"


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
    Failure.CHECK_STOPPED: "Checking this file was stopped before it finished. Upload it again.",
    Failure.PARSE_TOO_LARGE: (
        "Reading this file needed more memory than Parfocal allows, so the check was stopped. "
        "The file may be damaged."
    ),
    Failure.PARSE_TOO_SLOW: (
        "Reading this file took longer than Parfocal allows, so the check was stopped. "
        "The file may be damaged."
    ),
    **IMPORT_FAILURES,
    **LINK_IMPORT_FAILURES,
}
GENERIC_FAILURE = "Parfocal could not take this file in."


class FailureClass(StrEnum):
    TRANSIENT = "transient"
    PERMANENT = "permanent"


TRANSIENT_FAILURES = frozenset(
    {
        Failure.UPLOAD_MISSING,
        Failure.SIZE_MISMATCH,
        Failure.UPLOAD_ABORTED,
        Failure.UPLOAD_EXPIRED,
        Failure.CHECK_STOPPED,
        Refusal.TRUNCATED,
    }
)


def failure_class(code: str) -> FailureClass:
    if code in TRANSIENT_FAILURES:
        return FailureClass.TRANSIENT
    return FailureClass.PERMANENT


def failure_message(code: str) -> str:
    return FAILURES.get(code, GENERIC_FAILURE)


def original_suffix(name: str) -> str:
    suffix = PurePosixPath(name).suffix.lower()
    return suffix if suffix in ORIGINAL_SUFFIXES else ""


def slide_prefix(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> str:
    return f"t/{tenant_id}/s/{slide_id}/"


def restricted_prefix(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> str:
    return f"t/{tenant_id}/restricted/{slide_id}/"


class RestrictedImage(StrEnum):
    LABEL = "label"
    MACRO = "macro"


RESTRICTED_FILES: Mapping[RestrictedImage, tuple[str, str]] = {
    RestrictedImage.LABEL: ("label.png", "image/png"),
    RestrictedImage.MACRO: ("macro.jpg", "image/jpeg"),
}


def restricted_key(tenant_id: uuid.UUID, slide_id: uuid.UUID, image: RestrictedImage) -> str:
    return f"{restricted_prefix(tenant_id, slide_id)}{RESTRICTED_FILES[image][0]}"


def slide_prefixes(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> tuple[str, str]:
    return slide_prefix(tenant_id, slide_id), restricted_prefix(tenant_id, slide_id)


RESTRICTED_RANGES_NAME = "restricted-ranges.json"


def restricted_ranges_key(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> str:
    return f"{slide_prefix(tenant_id, slide_id)}{RESTRICTED_RANGES_NAME}"


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


SAMPLE_FILES_PREFIX = "samples/camelyon16/"
SAMPLE_FACTS_NAME = "facts.json"


def sample_folder(label: str) -> str:
    return f"{SAMPLE_FILES_PREFIX}{label}/"


def sample_original_key(label: str, name: str) -> str:
    return f"{sample_folder(label)}original{original_suffix(name)}"


FIXTURES_PREFIX = "fixtures/"
FIXTURE_SLIDES_PREFIX = "fixture-slides/"


def fixture_slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "-", name)[:64]


def fixture_folder(name: str) -> str:
    return f"{FIXTURE_SLIDES_PREFIX}{fixture_slug(name)}/"


def fixture_original_key(name: str) -> str:
    return f"{fixture_folder(name)}original{original_suffix(name)}"


def folder_of(key: str) -> str:
    return f"{PurePosixPath(key).parent}/"


class SlideFolderError(ValueError):
    pass


def slide_folder_in(value: object) -> str | None:
    if value is None:
        return None
    if (
        not isinstance(value, str)
        or not value.endswith("/")
        or value.startswith("/")
        or ".." in value.split("/")
    ):
        raise SlideFolderError("The slide folder is a storage prefix ending in a slash")
    return value
