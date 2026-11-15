import argparse
import hashlib
import json
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from parfocal_ml.calibration import (
    PANNUKE_TISSUES,
    POC_VIEWS,
    TyperCalibration,
    calibrate,
    poc_split,
)
from parfocal_ml.type_evaluation import Labels, Probabilities, bands_of, ece, scaled

FIT_SHARE = 0.5
BUCKETS = 2**64
MIN_SIDE_NUCLEI = 500
MIN_SIDE_SLIDES = 5
BAND_DIGITS = 3
ROW_DIGITS = 4


class NotEnoughHeldOutError(ValueError):
    pass


class NotCalibratedError(ValueError):
    pass


@dataclass(frozen=True)
class RoundOutputs:
    typer: str
    round_version: str
    test_time_views: int
    probabilities: Probabilities
    labels: Labels
    slides: Sequence[str]
    sites: NDArray[np.integer] | None = None


@dataclass(frozen=True)
class RoundCalibration:
    calibration: TyperCalibration
    fit_slides: int
    test_slides: int


@dataclass(frozen=True)
class PromotedRound:
    typer: str
    round_version: str
    calibrations: tuple[RoundCalibration, ...]


def fits_temperature(slide: str, share: float = FIT_SHARE) -> bool:
    digest = hashlib.sha256(b"parfocal.round-calibration:" + slide.encode()).digest()
    return int.from_bytes(digest[:8], "big") < share * BUCKETS


def recalibrate(
    outputs: RoundOutputs,
    held_out: Callable[[str], bool],
    site_names: Sequence[str] = PANNUKE_TISSUES,
) -> RoundCalibration:
    slides = np.asarray(outputs.slides, dtype=object)
    if len(slides) != len(outputs.labels) or len(outputs.probabilities) != len(outputs.labels):
        raise ValueError("probabilities, labels and slides must have one row per nucleus")
    keys = sorted(set(slides.tolist()))
    trained = [slide for slide in keys if not held_out(slide)]
    if trained:
        raise NotEnoughHeldOutError(f"{len(trained)} slides are on the training side of the split")
    fit_keys = {slide for slide in keys if fits_temperature(slide)}
    on_fit = np.fromiter((slide in fit_keys for slide in slides), bool, len(slides))
    test_slides = len(keys) - len(fit_keys)
    for side, count, nuclei in (
        ("fit", len(fit_keys), int(on_fit.sum())),
        ("test", test_slides, int((~on_fit).sum())),
    ):
        if count < MIN_SIDE_SLIDES or nuclei < MIN_SIDE_NUCLEI:
            raise NotEnoughHeldOutError(
                f"the {side} side has {count} slides and {nuclei} nuclei, "
                f"it needs {MIN_SIDE_SLIDES} and {MIN_SIDE_NUCLEI}"
            )
    sites = outputs.sites[~on_fit] if outputs.sites is not None else None
    calibration = calibrate(
        outputs.typer,
        outputs.round_version,
        outputs.test_time_views,
        outputs.probabilities[on_fit],
        outputs.labels[on_fit],
        outputs.probabilities[~on_fit],
        outputs.labels[~on_fit],
        sites,
        site_names,
    )
    return RoundCalibration(calibration, len(fit_keys), test_slides)


def promote(
    typer: str, round_version: str, calibrations: Sequence[RoundCalibration]
) -> PromotedRound:
    if not calibrations:
        raise NotCalibratedError(f"{typer} {round_version} has no fitted temperature")
    for row in calibrations:
        fitted = row.calibration
        if (fitted.typer, fitted.version) != (typer, round_version):
            raise NotCalibratedError(f"a calibration of {fitted.typer} {fitted.version} was given")
        if fitted.temperature <= 0 or len(fitted.bands) != 4:
            raise NotCalibratedError(
                f"{typer} {round_version} lacks a temperature or its four bands"
            )
    views = [row.calibration.test_time_views for row in calibrations]
    if len(set(views)) != len(views):
        raise NotCalibratedError(f"{typer} {round_version} has two calibrations for one view count")
    return PromotedRound(typer, round_version, tuple(calibrations))


def catalogue_row(row: RoundCalibration) -> dict[str, object]:
    fitted = row.calibration
    return {
        "typer": fitted.typer,
        "version": fitted.version,
        "test_time_views": fitted.test_time_views,
        "temperature": fitted.temperature,
        "ece_after": round(fitted.ece_after, ROW_DIGITS),
        "test_set_accuracy": round(fitted.test_set_accuracy, ROW_DIGITS),
        "test_set_confident_share": round(fitted.test_set_confident_share, ROW_DIGITS),
        "test_set_unsure_share": round(fitted.test_set_unsure_share, ROW_DIGITS),
        "validated_sites": list(fitted.validated_sites),
        "bands": [
            {
                "band": band.name,
                "lowest": band.lowest,
                "share": round(band.share, BAND_DIGITS),
                "accuracy": None if band.accuracy is None else round(band.accuracy, BAND_DIGITS),
            }
            for band in fitted.bands
        ],
        "fit_nuclei": fitted.fit_nuclei,
        "test_nuclei": fitted.test_nuclei,
        "fit_slides": row.fit_slides,
        "test_slides": row.test_slides,
    }


def train_head(
    features: NDArray[np.floating],
    labels: Labels,
    classes: int,
    steps: int = 300,
    rate: float = 0.5,
    decay: float = 1e-4,
) -> Callable[[NDArray[np.floating]], NDArray[np.float64]]:
    values = np.asarray(features, np.float64)
    mean = values.mean(axis=0)
    spread = values.std(axis=0) + 1e-6
    inputs = (values - mean) / spread
    weights = np.zeros((inputs.shape[1], classes))
    bias = np.zeros(classes)
    truth = np.eye(classes)[np.asarray(labels, np.int64)]
    for _ in range(steps):
        logits = inputs @ weights + bias
        logits -= logits.max(axis=1, keepdims=True)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum(axis=1, keepdims=True)
        error = (probabilities - truth) / len(inputs)
        weights -= rate * (inputs.T @ error + decay * weights)
        bias -= rate * error.sum(axis=0)

    def predict(rows: NDArray[np.floating]) -> NDArray[np.float64]:
        logits = ((np.asarray(rows, np.float64) - mean) / spread) @ weights + bias
        logits -= logits.max(axis=1, keepdims=True)
        found = np.exp(logits)
        return found / found.sum(axis=1, keepdims=True)

    return predict


def head_inputs(
    features: NDArray[np.floating], probabilities: Probabilities
) -> NDArray[np.float64]:
    return np.hstack([np.asarray(features, np.float64), np.log(np.clip(probabilities, 1e-7, 1.0))])


def poc_round(folder: Path, typer: str, round_version: str, stale: float) -> dict[str, object]:
    pooled = np.load(folder / "pathosam-features.npz")
    fit, fit_labels = poc_split(folder, "train", POC_VIEWS)
    test, labels = poc_split(folder, "test", POC_VIEWS)
    head = train_head(head_inputs(pooled["train_features"], fit), fit_labels, fit.shape[1])
    trained_side = head(head_inputs(pooled["train_features"], fit))
    held_out = head(head_inputs(pooled["test_features"], test))
    slides = [f"pannuke-fold3-{image}" for image in pooled["test_images"].tolist()]
    sites = np.load(folder / "fold3-nuclei.npz")["tissue"]
    outputs = RoundOutputs(typer, round_version, POC_VIEWS, held_out, labels, slides, sites)
    fitted = recalibrate(outputs, lambda _: True)
    measured = np.fromiter((not fits_temperature(slide) for slide in slides), bool, len(slides))
    on_test, test_labels = held_out[measured], labels[measured]
    leaked = calibrate(
        typer, round_version, POC_VIEWS, trained_side, fit_labels, on_test, test_labels
    )

    def scored(temperature: float) -> dict[str, object]:
        calibrated = scaled(on_test, temperature)
        return {
            "temperature": temperature,
            "ece": round(ece(calibrated, test_labels), ROW_DIGITS),
            "bands": [asdict(band) for band in bands_of(calibrated, test_labels)],
        }

    return {
        "typer_accuracy_on_test_side": round(
            float((test[measured].argmax(axis=1) == test_labels).mean()), ROW_DIGITS
        ),
        "round": catalogue_row(fitted),
        "uncalibrated": scored(1.0),
        "stale_temperature": scored(stale),
        "fitted_on_training_side": scored(leaked.temperature),
        "refit": scored(fitted.calibration.temperature),
    }


def round_outputs(
    path: Path, typer: str, round_version: str, views: int
) -> tuple[RoundOutputs, Callable[[str], bool]]:
    stored = np.load(path, allow_pickle=False)
    sites = stored["sites"] if "sites" in stored.files else None
    trained = (
        {str(slide) for slide in stored["trained_slides"].tolist()}
        if "trained_slides" in stored.files
        else set[str]()
    )
    return RoundOutputs(
        typer,
        round_version,
        views,
        stored["probabilities"].astype(np.float64),
        stored["labels"].astype(np.int64),
        [str(slide) for slide in stored["slides"].tolist()],
        sites,
    ), lambda slide: slide not in trained


def main(arguments: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m parfocal_ml.round_calibration")
    commands = parser.add_subparsers(dest="command", required=True)
    real = commands.add_parser("round")
    real.add_argument("outputs", type=Path)
    real.add_argument("--typer", required=True)
    real.add_argument("--version", required=True)
    real.add_argument("--views", type=int, default=1)
    synthetic = commands.add_parser("poc-round")
    synthetic.add_argument("folder", type=Path)
    synthetic.add_argument("--typer", default="pathosam-hovernext")
    synthetic.add_argument("--version", default="v1.2-round-1")
    synthetic.add_argument("--stale", type=float, default=1.29)
    options = parser.parse_args(arguments)
    if options.command == "round":
        outputs, held_out = round_outputs(
            options.outputs, options.typer, options.version, options.views
        )
        print(json.dumps(catalogue_row(recalibrate(outputs, held_out)), indent=2))
        return
    print(
        json.dumps(
            poc_round(options.folder, options.typer, options.version, options.stale), indent=2
        )
    )


if __name__ == "__main__":
    main()
