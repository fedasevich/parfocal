import xml.etree.ElementTree as ET
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage
from skimage import draw, measure

GROW_UM = 75.0
ITC_DIAMETER_UM = 200.0
FALSE_POSITIVE_RATES = (0.25, 0.5, 1.0, 2.0, 4.0, 8.0)
NMS_THRESHOLD = 0.5
NMS_BOX = 48
BUNDLE_SPACING_UM = 0.243
TUMOR_GROUPS = frozenset({"Tumor", "_0", "_1"})
EXCLUDED_GROUPS = frozenset({"None", "_2", "Exclusion"})

type Polygon = NDArray[np.float64]


@dataclass(frozen=True)
class Detection:
    probability: float
    row: int
    column: int


@dataclass(frozen=True)
class Lesions:
    labels: NDArray[np.int32]
    isolated: frozenset[int]

    @property
    def counted(self) -> int:
        return int(self.labels.max()) - len(self.isolated)


@dataclass(frozen=True)
class SlideHits:
    false_positives: tuple[float, ...]
    true_positives: tuple[float, ...]
    lesions: int


@dataclass(frozen=True)
class Froc:
    score: float
    sensitivities: tuple[float, ...]
    slides: int
    lesions: int
    false_positives: int


def annotation_polygons(xml: Path) -> dict[str, list[Polygon]]:
    groups: dict[str, list[Polygon]] = {}
    for annotation in ET.parse(xml).getroot().iter("Annotation"):
        coordinates = sorted(annotation.iter("Coordinate"), key=lambda c: int(c.get("Order", 0)))
        points = [(float(c.get("X", 0)), float(c.get("Y", 0))) for c in coordinates]
        if len(points) >= 3:
            groups.setdefault(annotation.get("PartOfGroup", ""), []).append(np.asarray(points))
    return groups


def filled(polygons: Sequence[Polygon], shape: tuple[int, int], cell: float) -> NDArray[np.bool_]:
    mask = np.zeros(shape, bool)
    for points in polygons:
        rows, columns = draw.polygon(points[:, 1] / cell, points[:, 0] / cell, shape)
        mask[rows, columns] = True
        corners = np.floor(points[:, ::-1] / cell).astype(np.int64)
        inside = (corners >= 0).all(axis=1) & (corners < shape).all(axis=1)
        mask[corners[inside, 0], corners[inside, 1]] = True
    return mask


def tumor_mask(
    groups: dict[str, list[Polygon]], shape: tuple[int, int], cell: float
) -> NDArray[np.bool_]:
    tumor = [p for name, found in groups.items() if name in TUMOR_GROUPS for p in found]
    excluded = [p for name, found in groups.items() if name in EXCLUDED_GROUPS for p in found]
    inside = np.zeros(shape, bool)
    for points in excluded:
        rows, columns = draw.polygon(points[:, 1] / cell, points[:, 0] / cell, shape)
        inside[rows, columns] = True
    return filled(tumor, shape, cell) & ~inside


def lesions_of(mask: NDArray[np.bool_], cell_um: float) -> Lesions:
    grow = GROW_UM / (cell_um * 2)
    distance = cast("NDArray[np.float64]", ndimage.distance_transform_edt(~mask))
    near = cast("NDArray[np.bool_]", ndimage.binary_fill_holes(distance < grow))
    labels = cast("NDArray[np.int32]", measure.label(near, connectivity=2)).astype(np.int32)
    itc = (ITC_DIAMETER_UM + GROW_UM) / cell_um
    isolated = frozenset(
        region.label for region in measure.regionprops(labels) if region.axis_major_length < itc
    )
    return Lesions(labels, isolated)


def detections(
    probability: NDArray[np.floating[Any]],
    threshold: float = NMS_THRESHOLD,
    box: int = NMS_BOX,
) -> list[Detection]:
    values = np.array(probability, dtype=np.float64, copy=True)
    below, above = box // 2, box - box // 2
    found: list[Detection] = []
    while True:
        index = int(np.argmax(values))
        row, column = divmod(index, values.shape[1])
        peak = float(values[row, column])
        if peak < threshold:
            return found
        found.append(Detection(peak, row, column))
        values[
            max(0, row - below) : min(values.shape[0], row + above),
            max(0, column - below) : min(values.shape[1], column + above),
        ] = 0


def slide_hits(found: Sequence[Detection], lesions: Lesions) -> SlideHits:
    best = np.zeros(int(lesions.labels.max()), np.float32)
    false_positives: list[float] = []
    for detection in found:
        label = int(lesions.labels[detection.row, detection.column])
        if label == 0:
            false_positives.append(detection.probability)
        elif label not in lesions.isolated:
            best[label - 1] = max(best[label - 1], detection.probability)
    return SlideHits(tuple(false_positives), tuple(float(p) for p in best), lesions.counted)


def froc(slides: Sequence[SlideHits], rates: Sequence[float] = FALSE_POSITIVE_RATES) -> Froc:
    false_positives = np.asarray([p for slide in slides for p in slide.false_positives])
    true_positives = np.asarray([p for slide in slides for p in slide.true_positives])
    lesions = sum(slide.lesions for slide in slides)
    thresholds = sorted(set(false_positives.tolist()) | set(true_positives.tolist()))[1:]
    fps = [float((false_positives >= t).sum()) for t in thresholds] + [0.0]
    tps = [float((true_positives >= t).sum()) for t in thresholds] + [0.0]
    per_slide = np.asarray(fps) / len(slides)
    sensitivity = np.asarray(tps) / lesions if lesions else np.zeros(len(tps))
    at_rates = np.interp(rates, per_slide[::-1], sensitivity[::-1])
    return Froc(
        float(np.mean(at_rates)),
        tuple(float(value) for value in at_rates),
        len(slides),
        lesions,
        len(false_positives),
    )
