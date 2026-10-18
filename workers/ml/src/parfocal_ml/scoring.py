from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray
from skimage import draw

SUPERSAMPLE = 4
MATCH_IOU = 0.5

type Ring = Sequence[float]
type Labels = NDArray[np.integer]


@dataclass(frozen=True)
class Nucleus:
    area: float
    iou: float

    @property
    def matched(self) -> bool:
        return self.iou > MATCH_IOU


@dataclass(frozen=True)
class ImageScore:
    nuclei: list[Nucleus]
    predicted: int
    matched_predictions: int
    aji: float
    group: str | None = None


@dataclass(frozen=True)
class Summary:
    nuclei: int
    predicted: int
    recall: float
    precision: float
    f1: float
    pq: float
    sq: float
    aji: float
    groups: dict[str, Summary] = field(default_factory=dict[str, "Summary"])


def upsample[T: np.generic](values: NDArray[T], scale: int = SUPERSAMPLE) -> NDArray[T]:
    return np.repeat(np.repeat(values, scale, axis=0), scale, axis=1)


def fill(
    ring: Ring, shape: tuple[int, int], scale: int = SUPERSAMPLE
) -> tuple[NDArray[np.intp], NDArray[np.intp]]:
    xs = np.asarray(ring[0::2], np.float64)
    ys = np.asarray(ring[1::2], np.float64)
    if len(xs) < 3:
        return np.zeros(0, np.intp), np.zeros(0, np.intp)
    return draw.polygon((ys + 0.5) * scale - 0.5, (xs + 0.5) * scale - 0.5, shape)


def without_vague(labels: Labels, ignore: NDArray[np.bool_] | None) -> Labels:
    if ignore is None:
        return labels
    count = int(labels.max())
    vague = np.bincount(labels[ignore], minlength=count + 1)
    area = np.bincount(labels.ravel(), minlength=count + 1)
    return np.where(np.isin(labels, np.nonzero(vague * 2 > area)[0]), 0, labels)


def score_image(
    labels: Labels,
    rings: Iterable[Ring],
    ignore: NDArray[np.bool_] | None = None,
    group: str | None = None,
) -> ImageScore:
    labels = without_vague(labels, ignore)
    count = int(labels.max())
    present = np.unique(labels)
    present = present[present > 0]
    fine = upsample(labels)
    fine_ignore = upsample(ignore) if ignore is not None else None
    shape = (int(fine.shape[0]), int(fine.shape[1]))
    predicted = np.zeros(shape, np.int32)
    kept = 0
    for ring in rings:
        rows, cols = fill(ring, shape)
        if len(rows) == 0:
            continue
        if fine_ignore is not None and fine_ignore[rows, cols].mean() > 0.5:
            continue
        kept += 1
        predicted[rows, cols] = kept
    truth_area = np.bincount(fine.ravel(), minlength=count + 1)
    predicted_area = np.bincount(predicted.ravel(), minlength=kept + 1)
    both = (fine > 0) & (predicted > 0)
    pairs, overlaps = np.unique(
        fine[both].astype(np.int64) * (kept + 1) + predicted[both], return_counts=True
    )
    best: dict[int, tuple[float, int, int]] = {}
    for pair, overlap in zip(pairs.tolist(), overlaps.tolist(), strict=True):
        truth, guess = divmod(pair, kept + 1)
        union = truth_area[truth] + predicted_area[guess] - overlap
        iou = overlap / union
        if iou > best.get(truth, (0.0, 0, 0))[0]:
            best[truth] = (iou, guess, overlap)
    nuclei: list[Nucleus] = []
    matched: set[int] = set()
    used: set[int] = set()
    joined = 0
    united = 0
    scale = SUPERSAMPLE**2
    for truth in present.tolist():
        iou, guess, overlap = best.get(truth, (0.0, 0, 0))
        nuclei.append(Nucleus(area=int(truth_area[truth]) / scale, iou=float(iou)))
        if iou > MATCH_IOU:
            matched.add(guess)
        if guess:
            used.add(guess)
            joined += overlap
            united += int(truth_area[truth] + predicted_area[guess] - overlap)
        else:
            united += int(truth_area[truth])
    united += sum(int(predicted_area[guess]) for guess in range(1, kept + 1) if guess not in used)
    return ImageScore(
        nuclei=nuclei,
        predicted=kept,
        matched_predictions=len(matched),
        aji=joined / united if united else 0.0,
        group=group,
    )


def summarise(scores: Sequence[ImageScore], *, by_group: bool = True) -> Summary:
    nuclei = [nucleus for score in scores for nucleus in score.nuclei]
    predicted = sum(score.predicted for score in scores)
    matched_predictions = sum(score.matched_predictions for score in scores)
    true_positives = sum(nucleus.matched for nucleus in nuclei)
    false_positives = predicted - matched_predictions
    false_negatives = len(nuclei) - true_positives
    ious = [nucleus.iou for nucleus in nuclei if nucleus.matched]
    denominator = true_positives + 0.5 * false_positives + 0.5 * false_negatives
    groups: dict[str, Summary] = {}
    if by_group:
        names = sorted({score.group for score in scores if score.group is not None})
        groups = {
            name: summarise([score for score in scores if score.group == name], by_group=False)
            for name in names
        }
    return Summary(
        nuclei=len(nuclei),
        predicted=predicted,
        recall=true_positives / max(1, len(nuclei)),
        precision=matched_predictions / max(1, predicted),
        f1=true_positives / max(1e-9, denominator),
        pq=sum(ious) / max(1e-9, denominator),
        sq=float(np.mean(ious)) if ious else 0.0,
        aji=float(np.mean([score.aji for score in scores])) if scores else 0.0,
        groups=groups,
    )
