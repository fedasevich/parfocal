import itertools
from typing import Any

import pytest

from parfocal_ml.datasets import cache_dir, samples

FOLD = "pannuke-fold3"


@pytest.fixture(scope="module")
def exported(tmp_path_factory: pytest.TempPathFactory) -> tuple[Any, Any]:
    from parfocal_ml.hovernext_export import checkpoint_path, export_typer, loaded_typer
    from parfocal_ml.outline_typer_worker import OnnxTyper

    if not checkpoint_path().exists():
        pytest.skip(f"HoVer-NeXt weights not in {checkpoint_path()}")
    if not (cache_dir() / FOLD / "fold_3.zip").exists():
        pytest.skip(f"{FOLD} is not cached in {cache_dir()}")
    typer = loaded_typer(checkpoint_path())
    target = tmp_path_factory.mktemp("hovernext") / "typer.onnx"
    export_typer(typer, target)
    return typer, OnnxTyper(target)


@pytest.mark.weights
def test_the_exported_typer_matches_torch_at_sizes_off_the_stride(exported: tuple[Any, Any]):
    from parfocal_ml.hovernext_export import PARITY_TOLERANCE, parity, tissue_crop

    typer, onnx = exported
    tiles = [sample.rgb for sample in itertools.islice(samples(FOLD), 2)]
    for height, width in ((256, 256), (300, 417)):
        check = parity(typer, onnx, tissue_crop(tiles, height, width))
        assert check.max_abs_difference < PARITY_TOLERANCE
        assert check.argmax_agreement == 1.0


@pytest.mark.weights
def test_the_exported_typer_types_pannuke_nuclei_well_above_chance(exported: tuple[Any, Any]):
    from parfocal_ml.hovernext_export import typing_check

    _, onnx = exported
    typing = typing_check(onnx, itertools.islice(samples(FOLD), 0, 50, 5))
    assert typing.nuclei > 50
    assert typing.viewer_accuracy > 0.7
