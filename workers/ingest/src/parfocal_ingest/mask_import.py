import re
from collections.abc import Mapping, Sequence
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Any, cast

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from parfocal_common.jobs import StepFailedError
from parfocal_common.result_imports import CheckProblem, ImportFailure
from parfocal_ingest.import_checks import SlideFrame, heatmap_guess, heatmap_guesses
from parfocal_ingest.results import ReadResult, read_class_mask, read_instance_mask

__all__ = [
    "MASK_NAMES",
    "RasterKind",
    "mask_downsample",
    "mask_objects",
    "mask_scale_problem",
    "raster_kind",
]

HEATMAP_LEVELS = 64
HEATMAP_WORDS = frozenset(
    {"heat", "heatmap", "prob", "probs", "probability", "probabilities", "score", "scores"}
)
INSTANCE_WORDS = frozenset(
    {"instance", "instances", "inst", "label", "labels", "nuclei", "nucleus", "cells"}
)
CLASS_WORDS = frozenset({"class", "classes", "semantic", "segmentation", "tissue", "regions"})
MASK_WORDS = frozenset({"mask", "masks", "seg"})


class RasterKind(StrEnum):
    HEATMAP = "heatmap"
    INSTANCE_MASK = "instance-mask"
    CLASS_MASK = "class-mask"


MASK_NAMES: Mapping[RasterKind, str] = {
    RasterKind.INSTANCE_MASK: "Instance mask import",
    RasterKind.CLASS_MASK: "Class mask import",
}


def words_of(file_name: str) -> frozenset[str]:
    stem = PurePosixPath(file_name.replace("\\", "/")).stem.lower()
    return frozenset(word for word in re.split(r"[^a-z0-9]+", stem) if word)


def parts_of(values: NDArray[Any]) -> int:
    _, count = cast("tuple[NDArray[np.int32], int]", ndimage.label(values != 0))
    return int(count)


def raster_kind(values: NDArray[Any], file_name: str) -> RasterKind:
    words = words_of(file_name)
    if values.dtype.kind == "f" or words & HEATMAP_WORDS:
        return RasterKind.HEATMAP
    if values.dtype.kind == "b" or words & CLASS_WORDS:
        return RasterKind.CLASS_MASK
    if words & INSTANCE_WORDS:
        return RasterKind.INSTANCE_MASK
    distinct = np.unique(values)
    labels = int(np.count_nonzero(distinct))
    if values.dtype.itemsize == 1 and labels > HEATMAP_LEVELS and not words & MASK_WORDS:
        return RasterKind.HEATMAP
    return RasterKind.INSTANCE_MASK if labels >= parts_of(values) else RasterKind.CLASS_MASK


def mask_downsample(shape: Sequence[int], frame: SlideFrame) -> float | None:
    if not frame.known:
        return 1.0
    fitted = heatmap_guess(shape, frame)
    return fitted.downsample if fitted is not None and fitted.level is not None else None


def mask_scale_problem(values: NDArray[Any], frame: SlideFrame) -> dict[str, Any]:
    guesses = heatmap_guesses(values, frame, None)
    if not guesses:
        raise StepFailedError(ImportFailure.MASK_UNPLACED)
    return {
        "code": CheckProblem.MASK_SCALE.value,
        "count": 1,
        "places": [],
        "guess": guesses[0].as_dict(),
        "guesses": [guess.as_dict() for guess in guesses],
    }


def mask_objects(
    values: NDArray[Any], kind: RasterKind, downsample: float, names: Mapping[int, str]
) -> ReadResult:
    if kind is RasterKind.INSTANCE_MASK:
        return read_instance_mask(values.astype(np.int64, copy=False), downsample)
    classes = values.astype(np.int64, copy=False)
    present = {int(value) for value in np.unique(classes) if value != 0}
    return read_class_mask(
        classes, {value: names.get(value, str(value)) for value in present}, downsample
    )
