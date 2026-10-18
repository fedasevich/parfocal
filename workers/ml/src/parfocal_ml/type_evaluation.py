from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

PROBABILITY_FLOOR = 1e-7
TEMPERATURES = np.round(np.arange(0.5, 10.0001, 0.01), 2)
BANDS = (("confident", 0.8), ("likely", 0.55), ("unsure", 0.4), ("doubtful", 0.0))
VIEWER_CLASSES = ("tumor", "stroma", "immune", "other")

type Probabilities = NDArray[np.floating]
type Labels = NDArray[np.integer]


@dataclass(frozen=True)
class Band:
    name: str
    lowest: float
    share: float
    accuracy: float | None


@dataclass(frozen=True)
class TypeEvaluation:
    nuclei: int
    accuracy: float
    balanced_accuracy: float
    recall: dict[str, float | None]
    precision: dict[str, float | None]
    confusion: list[list[int]]
    temperature: float
    ece_before: float
    ece_after: float
    bands: list[Band]


def mapped(labels: Labels, mapping: Sequence[int]) -> NDArray[np.int64]:
    return np.asarray(mapping, np.int64)[np.asarray(labels, np.int64)]


def scaled(probabilities: Probabilities, temperature: float) -> NDArray[np.float64]:
    values = np.asarray(probabilities, np.float64)
    if temperature == 1.0:
        return values
    logits = np.log(np.clip(values, PROBABILITY_FLOOR, 1.0)) / temperature
    logits -= logits.max(axis=-1, keepdims=True)
    weights = np.exp(logits)
    return weights / weights.sum(axis=-1, keepdims=True)


def nll(probabilities: Probabilities, labels: Labels) -> float:
    picked = probabilities[np.arange(len(labels)), labels]
    return float(-np.log(np.clip(picked, PROBABILITY_FLOOR, 1.0)).mean())


def ece(probabilities: Probabilities, labels: Labels, bins: int = 10) -> float:
    top = probabilities.max(axis=1)
    right = probabilities.argmax(axis=1) == labels
    total = 0.0
    for low in range(bins):
        inside = (top > low / bins) & (top <= (low + 1) / bins)
        if inside.any():
            total += float(inside.mean()) * abs(
                float(top[inside].mean()) - float(right[inside].mean())
            )
    return total


def fit_temperature(probabilities: Probabilities, labels: Labels) -> float:
    return float(min(TEMPERATURES, key=lambda value: nll(scaled(probabilities, value), labels)))


def bands_of(probabilities: Probabilities, labels: Labels) -> list[Band]:
    top = probabilities.max(axis=1)
    right = probabilities.argmax(axis=1) == labels
    found: list[Band] = []
    upper = 1.0001
    for name, lowest in BANDS:
        inside = (top >= lowest) & (top < upper)
        found.append(
            Band(
                name=name,
                lowest=lowest,
                share=float(inside.mean()),
                accuracy=float(right[inside].mean()) if inside.any() else None,
            )
        )
        upper = lowest
    return found


def evaluate(
    fit_probabilities: Probabilities,
    fit_labels: Labels,
    probabilities: Probabilities,
    labels: Labels,
    classes: Sequence[str] = VIEWER_CLASSES,
) -> TypeEvaluation:
    predicted = probabilities.argmax(axis=1)
    count = len(classes)
    confusion = np.zeros((count, count), np.int64)
    np.add.at(confusion, (labels, predicted), 1)
    recall: dict[str, float | None] = {}
    precision: dict[str, float | None] = {}
    for index, name in enumerate(classes):
        truth = labels == index
        called = predicted == index
        recall[name] = float((predicted[truth] == index).mean()) if truth.any() else None
        precision[name] = float((labels[called] == index).mean()) if called.any() else None
    temperature = fit_temperature(fit_probabilities, fit_labels)
    calibrated = scaled(probabilities, temperature)
    return TypeEvaluation(
        nuclei=len(labels),
        accuracy=float((predicted == labels).mean()),
        balanced_accuracy=float(np.mean([value for value in recall.values() if value is not None])),
        recall=recall,
        precision=precision,
        confusion=confusion.tolist(),
        temperature=temperature,
        ece_before=ece(probabilities, labels),
        ece_after=ece(calibrated, labels),
        bands=bands_of(calibrated, labels),
    )
