from pathlib import Path

import numpy as np
import pytest

from parfocal_common.jobs import StepFailedError
from parfocal_common.result_imports import ImportFailure
from parfocal_ingest.import_checks import SlideFrame
from parfocal_ingest.mask_import import (
    RasterKind,
    mask_downsample,
    mask_objects,
    mask_scale_problem,
    raster_kind,
)
from parfocal_ingest.results import ObjectKind, load_raster

RESULTS = Path(__file__).resolve().parent / "fixtures" / "results"


def raster(name: str) -> np.ndarray:
    return load_raster((RESULTS / name).read_bytes(), name)


def test_a_float_raster_stays_a_heatmap_and_labels_become_masks() -> None:
    assert raster_kind(raster("heatmap-level2.tif"), "upload.tif") is RasterKind.HEATMAP
    assert raster_kind(raster("instance-mask.png"), "upload.png") is RasterKind.INSTANCE_MASK
    assert raster_kind(raster("class-mask.png"), "upload.png") is RasterKind.CLASS_MASK


def test_a_name_says_which_kind_a_raster_is() -> None:
    labels = raster("instance-mask.png")
    assert raster_kind(labels, "A1_classes.png") is RasterKind.CLASS_MASK
    assert raster_kind(raster("class-mask.png"), "A1_labels.png") is RasterKind.INSTANCE_MASK
    assert raster_kind(labels.astype(np.uint8), "A1_prob.png") is RasterKind.HEATMAP


def test_a_byte_raster_with_many_values_is_a_heatmap_unless_named_a_mask() -> None:
    ramp = np.arange(64 * 64, dtype=np.uint32).reshape(64, 64) % 200
    values = ramp.astype(np.uint8)
    assert raster_kind(values, "A1.png") is RasterKind.HEATMAP
    assert raster_kind(values, "A1_mask.png") is not RasterKind.HEATMAP
    assert raster_kind(values > 100, "A1.png") is RasterKind.CLASS_MASK
    single = np.zeros((32, 32), np.uint8)
    single[2:6, 2:6] = 255
    assert raster_kind(single, "A1.png") is RasterKind.CLASS_MASK


def test_a_mask_at_a_slide_level_is_placed_and_any_other_size_is_asked() -> None:
    frame = SlideFrame(128, 128, 3, 0.25)
    assert mask_downsample((64, 64), frame) == 2.0
    assert mask_downsample((128, 128), frame) == 1.0
    assert mask_downsample((48, 48), frame) is None
    assert mask_downsample((48, 48), SlideFrame()) == 1.0
    asked = mask_scale_problem(np.ones((48, 48), np.uint8), frame)
    assert asked["code"] == "mask-scale"
    assert [guess["level"] for guess in asked["guesses"]] == [None, 0, 1, 2]
    with pytest.raises(StepFailedError) as unplaced:
        mask_scale_problem(np.ones((48, 20), np.uint8), SlideFrame(128, 128, None, 0.25))
    assert unplaced.value.code == ImportFailure.MASK_UNPLACED


def test_class_values_take_project_class_names_by_key() -> None:
    found = mask_objects(raster("class-mask.png"), RasterKind.CLASS_MASK, 1.0, {1: "Tumor"})
    assert found.problems == []
    assert [(item.kind, item.class_name) for item in found.objects] == [
        (ObjectKind.REGION, "Tumor"),
        (ObjectKind.REGION, "Tumor"),
        (ObjectKind.REGION, "2"),
        (ObjectKind.REGION, "7"),
    ]
    cells = mask_objects(raster("instance-mask.png"), RasterKind.INSTANCE_MASK, 2.0, {})
    assert [item.kind for item in cells.objects] == [ObjectKind.CELL] * 3
