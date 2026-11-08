import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from parfocal_ml.type_evaluation import Band, Labels, Probabilities, evaluate, scaled

CONFIDENT = 0.8
DOUBTFUL_BELOW = 0.4
CLOSE_GAP = 0.1
MIN_SITE_NUCLEI = 100
MIN_SITE_ACCURACY = 0.7
PANNUKE_TISSUES = (
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
    "Lung",
    "Ovarian",
    "Pancreatic",
    "Prostate",
    "Skin",
    "Stomach",
    "Testis",
    "Thyroid",
    "Uterus",
)
POC_VIEWS = 8
POC_CLASSES = 4


@dataclass(frozen=True)
class TyperCalibration:
    typer: str
    version: str
    test_time_views: int
    temperature: float
    fit_nuclei: int
    test_nuclei: int
    ece_before: float
    ece_after: float
    test_set_accuracy: float
    test_set_confident_share: float
    test_set_unsure_share: float
    validated_sites: tuple[str, ...]
    bands: tuple[Band, ...]


def unsure_share(probabilities: Probabilities) -> float:
    ranked = np.sort(probabilities, axis=1)
    first, second = ranked[:, -1], ranked[:, -2]
    unsure = (first < DOUBTFUL_BELOW) | (first - second < CLOSE_GAP)
    return float(unsure.mean())


def validated_sites(
    probabilities: Probabilities, labels: Labels, sites: NDArray[np.integer], names: Sequence[str]
) -> tuple[str, ...]:
    right = probabilities.argmax(axis=1) == labels
    found: list[str] = []
    for index, name in enumerate(names):
        inside = sites == index
        if inside.sum() >= MIN_SITE_NUCLEI and right[inside].mean() >= MIN_SITE_ACCURACY:
            found.append(name)
    return tuple(found)


def calibrate(
    typer: str,
    version: str,
    test_time_views: int,
    fit_probabilities: Probabilities,
    fit_labels: Labels,
    probabilities: Probabilities,
    labels: Labels,
    sites: NDArray[np.integer] | None = None,
    site_names: Sequence[str] = PANNUKE_TISSUES,
) -> TyperCalibration:
    result = evaluate(fit_probabilities, fit_labels, probabilities, labels)
    calibrated = scaled(probabilities, result.temperature)
    return TyperCalibration(
        typer=typer,
        version=version,
        test_time_views=test_time_views,
        temperature=result.temperature,
        fit_nuclei=len(fit_labels),
        test_nuclei=result.nuclei,
        ece_before=result.ece_before,
        ece_after=result.ece_after,
        test_set_accuracy=result.accuracy,
        test_set_confident_share=float((calibrated.max(axis=1) >= CONFIDENT).mean()),
        test_set_unsure_share=unsure_share(calibrated),
        validated_sites=(
            validated_sites(calibrated, labels, sites, site_names) if sites is not None else ()
        ),
        bands=tuple(result.bands),
    )


def poc_split(folder: Path, split: str, views: int) -> tuple[NDArray[np.float64], Labels]:
    labels = np.fromfile(folder / f"hovernext-{split}.labels.u8", np.uint8).astype(np.int64)
    probabilities = np.fromfile(folder / f"hovernext-{split}.views.f32", np.float32).reshape(
        len(labels), POC_VIEWS, POC_CLASSES
    )
    return probabilities[:, :views].mean(axis=1).astype(np.float64), labels


def poc_calibrations(folder: Path, typer: str, version: str) -> list[TyperCalibration]:
    sites = np.load(folder / "fold3-nuclei.npz")["tissue"]
    found: list[TyperCalibration] = []
    for views in (1, POC_VIEWS):
        fit, fit_labels = poc_split(folder, "train", views)
        test, labels = poc_split(folder, "test", views)
        found.append(calibrate(typer, version, views, fit, fit_labels, test, labels, sites))
    return found


def main(arguments: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m parfocal_ml.calibration")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--typer", default="pathosam-hovernext")
    parser.add_argument("--version", default="v1.2")
    options = parser.parse_args(arguments)
    rows = [asdict(row) for row in poc_calibrations(options.folder, options.typer, options.version)]
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
