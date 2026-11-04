import numpy as np
import pytest

from parfocal_ml.typer import (
    CLASS_CHANNELS,
    TYPER_MPP,
    Outline,
    pannuke_to_viewer,
    tissue_default_for,
    to_viewer,
    type_nuclei,
)

NEOPLASTIC, INFLAMMATORY, CONNECTIVE, DEAD, EPITHELIAL = range(1, 6)


def class_map_with(height: int, width: int, regions: list[tuple[slice, slice, list[float]]]):
    class_map = np.zeros((CLASS_CHANNELS, height, width), np.float32)
    class_map[0] = 1.0
    for rows, cols, channels in regions:
        class_map[:, rows, cols] = np.asarray(channels, np.float32)[:, None, None]
    return class_map


def stub(class_map):
    calls = []

    def model(rgb):
        calls.append(rgb.shape)
        return class_map

    return model, calls


def square(x: int, y: int, size: int = 4) -> Outline:
    return Outline(np.ones((size, size), bool), x, y)


def test_mapping_follows_the_poc_order() -> None:
    assert pannuke_to_viewer("other") == (0, 2, 1, 3, 3)
    assert pannuke_to_viewer("tumor") == (0, 2, 1, 3, 0)


def test_probabilities_sum_to_one_for_random_maps() -> None:
    generator = np.random.default_rng(7)
    logits = generator.normal(size=(CLASS_CHANNELS, 32, 32)).astype(np.float32)
    class_map = np.exp(logits) / np.exp(logits).sum(axis=0, keepdims=True)
    model, _ = stub(class_map)
    outlines = [square(x, y, 5) for x in range(0, 28, 6) for y in range(0, 28, 6)]
    outlines.append(Outline(np.ones((6, 6), bool), 29, -2))
    rgb = np.zeros((32, 32, 3), np.uint8)
    for tissue_default in ("other", "tumor"):
        for nucleus in type_nuclei(rgb, outlines, model, tissue_default=tissue_default):
            assert sum(nucleus.probabilities.values()) == pytest.approx(1.0)
            assert all(value >= 0 for value in nucleus.probabilities.values())


def test_probabilities_are_averaged_inside_each_outline() -> None:
    half_tumor = [0.2, 0.8, 0.0, 0.0, 0.0, 0.0]
    half_stroma = [0.2, 0.0, 0.0, 0.8, 0.0, 0.0]
    class_map = class_map_with(
        8, 8, [(slice(0, 4), slice(0, 2), half_tumor), (slice(0, 4), slice(2, 4), half_stroma)]
    )
    model, _ = stub(class_map)
    [nucleus] = type_nuclei(np.zeros((8, 8, 3), np.uint8), [square(0, 0)], model)
    assert nucleus.probabilities == pytest.approx(
        {"tumor": 0.5, "stroma": 0.5, "immune": 0.0, "other": 0.0}
    )
    assert nucleus.foreground == pytest.approx(0.8)
    assert nucleus.alternatives == ["stroma"]


def test_epithelial_goes_to_other_without_the_tissue_default() -> None:
    epithelial = [0.0, 0.1, 0.0, 0.0, 0.1, 0.8]
    class_map = class_map_with(8, 8, [(slice(0, 4), slice(0, 4), epithelial)])
    model, _ = stub(class_map)
    [nucleus] = type_nuclei(np.zeros((8, 8, 3), np.uint8), [square(0, 0)], model)
    assert nucleus.type == "other"
    assert nucleus.probabilities["other"] == pytest.approx(0.9)
    assert nucleus.probabilities["tumor"] == pytest.approx(0.1)


def test_tissue_default_sends_epithelial_to_tumor_but_not_dead() -> None:
    epithelial = [0.0, 0.1, 0.0, 0.0, 0.1, 0.8]
    class_map = class_map_with(8, 8, [(slice(0, 4), slice(0, 4), epithelial)])
    model, _ = stub(class_map)
    [nucleus] = type_nuclei(
        np.zeros((8, 8, 3), np.uint8), [square(0, 0)], model, tissue_default="tumor"
    )
    assert nucleus.type == "tumor"
    assert nucleus.probabilities["tumor"] == pytest.approx(0.9)
    assert nucleus.probabilities["other"] == pytest.approx(0.1)


def test_tissue_default_comes_from_the_slide_tissue() -> None:
    assert tissue_default_for("Uterus") == "tumor"
    assert tissue_default_for(" prostate ") == "tumor"
    assert tissue_default_for("Thyroid") == "other"
    assert tissue_default_for(None) == "other"


def test_to_viewer_keeps_the_total() -> None:
    pannuke = np.array([[0.1, 0.2, 0.3, 0.15, 0.25]])
    for tissue_default in ("other", "tumor"):
        assert to_viewer(pannuke, tissue_default).sum() == pytest.approx(1.0)


def test_outline_outside_the_tile_gets_an_even_split() -> None:
    model, _ = stub(class_map_with(8, 8, []))
    [nucleus] = type_nuclei(np.zeros((8, 8, 3), np.uint8), [square(20, 20)], model)
    assert set(nucleus.probabilities.values()) == {0.25}
    assert nucleus.foreground == 0.0


def test_tile_is_resampled_to_the_typer_resolution() -> None:
    tumor = [0.0, 1.0, 0.0, 0.0, 0.0, 0.0]
    model, calls = stub(class_map_with(16, 16, [(slice(0, 16), slice(0, 16), tumor)]))
    rgb = np.zeros((8, 8, 3), np.uint8)
    [nucleus] = type_nuclei(rgb, [square(2, 2)], model, mpp=TYPER_MPP * 2)
    assert calls == [(16, 16, 3)]
    assert nucleus.type == "tumor"
    assert sum(nucleus.probabilities.values()) == pytest.approx(1.0)


def test_no_outlines_skip_the_model() -> None:
    model, calls = stub(class_map_with(8, 8, []))
    assert type_nuclei(np.zeros((8, 8, 3), np.uint8), [], model) == []
    assert calls == []
