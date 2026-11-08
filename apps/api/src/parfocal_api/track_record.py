import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.blinding import user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.model_catalogue import (
    BAND_CUTOFFS,
    ConfidenceBand,
    TyperCalibration,
    band_at,
    calibration_of,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.tables import (
    AnnotationKind,
    VerdictValue,
    result_sets,
    review_task_slides,
    verdicts,
)
from parfocal_common.model_runs import model_runs
from parfocal_common.review_order import BYTE

MIN_CHECKS = 20
MIN_BAND_CHECKS = 5
MIN_BAND_SHARE = 0.05

BANDS = tuple(band for band, _ in BAND_CUTOFFS)

SCORE_MEANING = (
    "Bands split the calibrated confidence the reviewer was shown, saved with each cell "
    "decision. Agree keeps the call, disagree overturns it, not sure counts as neither."
)
OVERALL_MEANING = (
    "The share of calls kept, weighted by the typer's recorded band shares rather than by "
    "the calls the queue happened to show. Withheld until at least 20 calls are checked and "
    "every band holding at least 5% of the typer's test set has at least 5 checks. Always "
    "withheld for a typer with no recorded calibration."
)


class Withheld(StrEnum):
    TOO_FEW_CHECKS = "too-few-checks"
    BANDS_UNCHECKED = "bands-unchecked"
    UNCALIBRATED = "uncalibrated"


class BandRecord(BaseModel):
    band: ConfidenceBand
    checked: int
    kept: int
    kept_share: float | None = Field(description="Null until the band has at least 5 checks")
    recorded_share: float | None = Field(
        description="Share of the typer's test set in this band, null when not measured"
    )
    recorded_accuracy: float | None = Field(
        description="How often the typer was right in this band on its test set, null when "
        "not measured"
    )


class TyperRecord(BaseModel):
    typer: str
    typer_version: str | None
    test_time_views: int
    calibrated: bool
    checked: int
    kept: int
    bands: list[BandRecord] = Field(description=SCORE_MEANING)
    unchecked_bands: list[ConfidenceBand] = Field(
        description="Bands that hold at least 5% of the typer's test set and have under 5 checks"
    )
    overall_kept_share: float | None = Field(description=OVERALL_MEANING)
    overall_withheld: Withheld | None


class TrackRecord(BaseModel):
    typers: list[TyperRecord]


@dataclass
class Tally:
    checked: int = 0
    kept: int = 0

    def add(self, kept: bool, count: int = 1) -> None:
        self.checked += count
        if kept:
            self.kept += count

    @property
    def share(self) -> float | None:
        return self.kept / self.checked if self.checked >= MIN_BAND_CHECKS else None


@dataclass(frozen=True)
class TyperKey:
    typer: str
    typer_version: str | None
    test_time_views: int


def band_split(
    calibration: TyperCalibration | None, calls: Iterable[tuple[int, bool, int]]
) -> dict[ConfidenceBand, Tally]:
    tallies = {band: Tally() for band in BANDS}
    for score, kept, count in calls:
        probability = score / BYTE
        band = calibration.band_of(probability) if calibration is not None else band_at(probability)
        tallies[band].add(kept, count)
    return tallies


def overall_of(
    calibration: TyperCalibration | None, tallies: dict[ConfidenceBand, Tally]
) -> tuple[float | None, Withheld | None, list[ConfidenceBand]]:
    if calibration is None:
        return None, Withheld.UNCALIBRATED, []
    shares = {row.band: row.share for row in calibration.bands}
    unchecked = [
        band
        for band in BANDS
        if shares.get(band, 0.0) >= MIN_BAND_SHARE and tallies[band].share is None
    ]
    if sum(tally.checked for tally in tallies.values()) < MIN_CHECKS:
        return None, Withheld.TOO_FEW_CHECKS, unchecked
    if unchecked:
        return None, Withheld.BANDS_UNCHECKED, unchecked
    weighted = [
        (shares[band], share)
        for band, tally in tallies.items()
        if (share := tally.share) is not None and band in shares
    ]
    weight = sum(band_share for band_share, _ in weighted)
    if weight <= 0:
        return None, Withheld.BANDS_UNCHECKED, unchecked
    return sum(band_share * share for band_share, share in weighted) / weight, None, unchecked


def typer_record(key: TyperKey, calls: Iterable[tuple[int, bool, int]]) -> TyperRecord:
    calibration = (
        calibration_of(key.typer, key.typer_version, key.test_time_views)
        if key.typer_version is not None
        else None
    )
    tallies = band_split(calibration, calls)
    recorded = {row.band: row for row in calibration.bands} if calibration is not None else {}
    overall, withheld, unchecked = overall_of(calibration, tallies)
    return TyperRecord(
        typer=key.typer,
        typer_version=key.typer_version,
        test_time_views=key.test_time_views,
        calibrated=calibration is not None,
        checked=sum(tally.checked for tally in tallies.values()),
        kept=sum(tally.kept for tally in tallies.values()),
        bands=[
            BandRecord(
                band=band,
                checked=tally.checked,
                kept=tally.kept,
                kept_share=tally.share,
                recorded_share=recorded[band].share if band in recorded else None,
                recorded_accuracy=recorded[band].accuracy if band in recorded else None,
            )
            for band, tally in tallies.items()
        ],
        unchecked_bands=unchecked,
        overall_kept_share=overall,
        overall_withheld=withheld,
    )


async def track_record_of(
    connection: AsyncConnection, user_id: uuid.UUID | None, project_id: uuid.UUID | None
) -> TrackRecord:
    typer = func.coalesce(model_runs.c.typer, model_runs.c.detector, result_sets.c.name)
    version = func.coalesce(
        model_runs.c.typer_version, model_runs.c.detector_version, result_sets.c.model_version
    )
    views = func.coalesce(model_runs.c.test_time_views, 1)
    kept = verdicts.c.value == VerdictValue.AGREE
    query = (
        select(
            typer.label("typer"),
            version.label("version"),
            views.label("views"),
            verdicts.c.ai_score,
            kept.label("kept"),
            func.count().label("decisions"),
        )
        .select_from(verdicts)
        .join(
            review_task_slides,
            (review_task_slides.c.task_id == verdicts.c.task_id)
            & (review_task_slides.c.slide_id == verdicts.c.slide_id),
        )
        .join(result_sets, result_sets.c.id == review_task_slides.c.result_set_id)
        .outerjoin(model_runs, model_runs.c.job_id == result_sets.c.job_id)
        .where(
            verdicts.c.user_id == user_id,
            verdicts.c.kind == AnnotationKind.CELL,
            verdicts.c.value.in_([VerdictValue.AGREE, VerdictValue.DISAGREE]),
            verdicts.c.ai_score.is_not(None),
        )
        .group_by(typer, version, views, verdicts.c.ai_score, kept)
    )
    if project_id is not None:
        query = query.where(verdicts.c.project_id == project_id)
    grouped: dict[TyperKey, list[tuple[int, bool, int]]] = defaultdict(list)
    for row in await connection.execute(query):
        key = TyperKey(row.typer, row.version, int(row.views))
        grouped[key].append((int(row.ai_score), bool(row.kept), int(row.decisions)))
    records = [typer_record(key, calls) for key, calls in grouped.items()]
    records.sort(key=lambda record: (-record.checked, record.typer, record.typer_version or ""))
    return TrackRecord(typers=records)


router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("/track-record", operation_id="getMyTrackRecord", **require(Permission.REVIEW))
async def get_my_track_record(
    principal: CurrentPrincipal,
    connection: TenantConnection,
    project_id: Annotated[uuid.UUID | None, Query()] = None,
) -> TrackRecord:
    return await track_record_of(connection, user_of(principal), project_id)
