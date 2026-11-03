import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import StringConstraints


class ModelMakes(StrEnum):
    REGIONS = "regions"
    CELLS = "cells"
    HEATMAP = "heatmap"


class ModelHost(StrEnum):
    PARFOCAL = "parfocal"
    LAB = "lab"


type ModelName = Annotated[
    str,
    StringConstraints(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._/-]*$"),
]
type ModelVersion = Annotated[
    str,
    StringConstraints(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9][A-Za-z0-9._+-]*$"),
]

PARFOCAL_SERVER = "Parfocal GPU"
MIN_SAMPLES = 3
LAST_SAMPLES = 20


@dataclass(frozen=True)
class CatalogueModel:
    name: str
    version: str
    title: str
    description: str
    makes: tuple[ModelMakes, ...]
    nominal_minutes: int


CATALOGUE: tuple[CatalogueModel, ...] = (
    CatalogueModel(
        "camelyon-tumor",
        "v1.0",
        "CAMELYON tumor model",
        "Tumor regions and a heatmap",
        (ModelMakes.REGIONS, ModelMakes.HEATMAP),
        4,
    ),
    CatalogueModel(
        "pathosam-hovernext",
        "v1.2",
        "PathoSAM + HoVer-NeXt",
        "Tumor regions and every cell with a type",
        (ModelMakes.REGIONS, ModelMakes.CELLS),
        17,
    ),
    CatalogueModel(
        "hovernet",
        "v0.9",
        "HoVer-Net",
        "Every cell with a type, no regions",
        (ModelMakes.CELLS,),
        9,
    ),
)
BY_NAME: Mapping[str, CatalogueModel] = {model.name: model for model in CATALOGUE}


@dataclass(frozen=True)
class TyperCalibration:
    temperature: float
    ece_after: float
    test_set_accuracy: float
    test_set_confident_share: float
    test_set_unsure_share: float
    validated_sites: tuple[str, ...]


PANNUKE_SITES_BUT_LUNG = (
    "Adrenal Gland",
    "Bile Duct",
    "Bladder",
    "Breast",
    "Cervix",
    "Colon",
    "Esophagus",
    "Head & Neck",
    "Kidney",
    "Liver",
    "Ovarian",
    "Pancreatic",
    "Prostate",
    "Skin",
    "Stomach",
    "Testis",
    "Thyroid",
    "Uterus",
)

CALIBRATIONS: Mapping[tuple[str, str, int], TyperCalibration] = {
    ("pathosam-hovernext", "v1.2", 1): TyperCalibration(
        temperature=1.42,
        ece_after=0.0223,
        test_set_accuracy=0.8297,
        test_set_confident_share=0.5941,
        test_set_unsure_share=0.0755,
        validated_sites=PANNUKE_SITES_BUT_LUNG,
    ),
    ("pathosam-hovernext", "v1.2", 8): TyperCalibration(
        temperature=1.29,
        ece_after=0.0187,
        test_set_accuracy=0.8348,
        test_set_confident_share=0.6076,
        test_set_unsure_share=0.0694,
        validated_sites=PANNUKE_SITES_BUT_LUNG,
    ),
}


def calibration_of(name: str, version: str, test_time_views: int) -> TyperCalibration | None:
    return CALIBRATIONS.get((name, version, test_time_views))


def latest_version(name: str) -> str | None:
    model = BY_NAME.get(name)
    return model.version if model is not None else None


@dataclass(frozen=True)
class Throughput:
    minutes_per_slide: int
    measured: bool


def throughput(samples: Sequence[float], nominal_minutes: int) -> Throughput:
    if len(samples) < MIN_SAMPLES:
        return Throughput(nominal_minutes, False)
    mean = sum(samples) / len(samples)
    return Throughput(max(1, round(mean / 60)), True)


@dataclass(frozen=True)
class QueuedRun:
    detector: str
    running_since: datetime | None


def queue_minutes(
    ahead: Iterable[QueuedRun], minutes_by_model: Mapping[str, int], fallback: int, now: datetime
) -> int:
    total = 0.0
    for run in ahead:
        minutes = float(minutes_by_model.get(run.detector, fallback))
        if run.running_since is not None:
            minutes -= (now - run.running_since).total_seconds() / 60
        total += max(0.0, minutes)
    return math.ceil(total)
