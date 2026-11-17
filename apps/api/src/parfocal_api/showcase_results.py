from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, Field

from parfocal_api.result_sets import RegionRow
from parfocal_api.tables import ResultObjectKind
from parfocal_common.chunk_store import Cell
from parfocal_common.repository import repository_root

MODEL_RESULTS = repository_root(__file__) / "packages/test-fixtures/model-results"
REGIONS_FILE = "regions.parfocal.json"
CELLS_FILE = "cells.geojson"
REGIONS_MODEL = "MONAI tumour detection 0.6.4, ONNX"
CELLS_MODEL = "InstanSeg v0.1.1, HoVer-NeXt PanNuke typer"
SCORE_SCALE = 255


class Polygon(BaseModel):
    coordinates: list[list[tuple[float, float]]]


class RegionObject(BaseModel):
    kind: str
    geometry: Polygon
    class_name: str = Field(alias="class")
    score: float | None = None


class RegionsFile(BaseModel):
    objects: list[RegionObject]


class Classification(BaseModel):
    name: str


class CellProperties(BaseModel):
    classification: Classification
    score: float | None = None
    probabilities: dict[str, float] = Field(default_factory=dict[str, float])


class CellFeature(BaseModel):
    geometry: Polygon
    properties: CellProperties


class CellsFile(BaseModel):
    features: list[CellFeature]


@dataclass(frozen=True)
class ModelRegions:
    classes: list[str]
    rows: list[RegionRow]


@dataclass(frozen=True)
class ModelCells:
    classes: list[str]
    cells: list[Cell]


def folder_of(label: str, root: Path = MODEL_RESULTS) -> Path:
    return root / label.split(".", 1)[0].lower().replace("_", "-")


def scaled(value: float | None) -> int:
    return max(0, min(SCORE_SCALE, round((value or 0.0) * SCORE_SCALE)))


def ring_of(polygon: Polygon) -> list[tuple[float, float]]:
    ring = polygon.coordinates[0]
    return ring[:-1] if ring[0] == ring[-1] else ring


def wkt_of(ring: list[tuple[float, float]]) -> str:
    closed = [*ring, ring[0]]
    return "POLYGON((" + ",".join(f"{x:g} {y:g}" for x, y in closed) + "))"


def model_regions(label: str, root: Path = MODEL_RESULTS) -> ModelRegions | None:
    path = folder_of(label, root) / REGIONS_FILE
    if not path.is_file():
        return None
    found = RegionsFile.model_validate_json(path.read_bytes()).objects
    objects = [item for item in found if item.kind == "region"]
    if not objects:
        return None
    classes = sorted({item.class_name for item in objects})
    rows = [
        RegionRow(
            kind=ResultObjectKind.REGION,
            number=number,
            wkt=wkt_of(ring_of(item.geometry)),
            class_position=classes.index(item.class_name),
            score=scaled(item.score),
        )
        for number, item in enumerate(objects, start=1)
    ]
    return ModelRegions(classes, rows)


def model_cells(label: str, root: Path = MODEL_RESULTS) -> ModelCells | None:
    path = folder_of(label, root) / CELLS_FILE
    if not path.is_file():
        return None
    features = CellsFile.model_validate_json(path.read_bytes()).features
    if not features:
        return None
    classes = sorted(
        {
            name
            for feature in features
            for name in [feature.properties.classification.name, *feature.properties.probabilities]
        }
    )
    cells = [
        Cell(
            number=number,
            ring=tuple(value for point in ring_of(feature.geometry) for value in point),
            class_index=classes.index(feature.properties.classification.name),
            score=scaled(feature.properties.score),
            probs=[scaled(feature.properties.probabilities.get(name)) for name in classes]
            if feature.properties.probabilities
            else None,
        )
        for number, feature in enumerate(features, start=1)
    ]
    return ModelCells(classes, cells)
