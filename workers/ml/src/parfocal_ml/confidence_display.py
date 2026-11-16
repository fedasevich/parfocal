import argparse
import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from parfocal_ml.calibration import POC_VIEWS, poc_split
from parfocal_ml.type_evaluation import BANDS, fit_temperature, scaled

TUMOR = 0
CLOSE = 0.1
CUTOFFS = (0.1, 0.2, 0.3, 0.5)
REGION_MIN = 300
BUDGETS = (0.0, 0.05, 0.1, 0.2, 0.4)
STRATEGIES = ("tumor contested", "least sure", "random")
SEED = 0
FREQUENCY_MIN_CELLS = 30
CATALOGUE_DIGITS = 3
WARN_MIN_TYPED = 100
WARN_CONFIDENT_RATIO = 0.6
WARN_CONFIDENT_FLOOR = 0.2
WARN_UNSURE_EXCESS = 0.15
PHRASES = ("A", "probably A", "possibly A", "A or B", "unclear, perhaps A or B")

type Indices = NDArray[np.int64]
type Report = dict[str, Any]


@dataclass(frozen=True)
class Calls:
    chosen: Indices
    other: Indices
    score: NDArray[np.float64]
    band: Indices
    close: NDArray[np.bool_]
    unsure: NDArray[np.bool_]
    tumor: NDArray[np.float64]


def calls_of(probabilities: NDArray[np.float64]) -> Calls:
    rows = np.arange(len(probabilities))
    chosen = probabilities.argmax(axis=1)
    rest = probabilities.copy()
    rest[rows, chosen] = -1
    other = rest.argmax(axis=1)
    score = probabilities[rows, chosen]
    band = np.full(len(score), len(BANDS) - 1)
    for index, (_, low) in reversed(list(enumerate(BANDS))):
        band[score >= low] = index
    close = score - probabilities[rows, other] < CLOSE
    return Calls(
        chosen=chosen,
        other=other,
        score=score,
        band=band,
        close=close,
        unsure=(band == len(BANDS) - 1) | close,
        tumor=probabilities[:, TUMOR].astype(np.float64),
    )


def patch_regions(image: Indices, tissue: Indices) -> list[Indices]:
    found: list[Indices] = []
    for kind in np.unique(tissue):
        members = np.flatnonzero(tissue == kind)
        current: list[int] = []
        for picture in np.unique(image[members]):
            current.extend(np.flatnonzero(image == picture).tolist())
            if len(current) >= REGION_MIN:
                found.append(np.asarray(current))
                current = []
    return found


def side(low: float, high: float, cutoff: float) -> str:
    if low >= cutoff:
        return "above"
    if high < cutoff:
        return "below"
    return "either"


def share_ranges(calls: Calls, members: Indices) -> dict[str, tuple[float, float, float]]:
    n = len(members)
    chosen = calls.chosen[members]
    called = chosen == TUMOR
    unsure = calls.unsure[members]
    count = called.sum()
    lost = (called & unsure).sum()
    gained = (~called & unsure & (calls.other[members] == TUMOR)).sum()
    p = calls.tumor[members]
    spread = 1.96 * np.sqrt((p * (1 - p)).sum()) / n
    return {
        "expected mistakes": (count / n, p[called].sum() / n, (count + p[~called].sum()) / n),
        "flips": (count / n, (count - lost) / n, (count + gained) / n),
        "binomial": (p.mean(), p.mean() - spread, p.mean() + spread),
    }


def range_report(calls: Calls, labels: Indices, regions: list[Indices]) -> Report:
    report: Report = {}
    for name in ("expected mistakes", "flips", "binomial"):
        covered, widths, errors, firm, firm_right, total = [], [], [], 0, 0, 0
        for members in regions:
            truth = float((labels[members] == TUMOR).mean())
            point, low, high = share_ranges(calls, members)[name]
            covered.append(low <= truth <= high)
            widths.append(high - low)
            errors.append(abs(point - truth))
            for cutoff in CUTOFFS:
                total += 1
                answer = side(low, high, cutoff)
                if answer != "either":
                    firm += 1
                    firm_right += int((answer == "above") == (truth >= cutoff))
        report[name] = {
            "covers_truth": float(np.mean(covered)),
            "mean_width_pp": float(np.mean(widths) * 100),
            "point_error_pp": float(np.mean(errors) * 100),
            "firm_share": firm / total,
            "firm_right": firm_right / firm if firm else None,
            "firm_wrong": firm - firm_right,
        }
    return report


def review_order(
    strategy: str, calls: Calls, members: Indices, generator: np.random.Generator
) -> Indices:
    if strategy == "tumor contested":
        p = calls.tumor[members]
        return np.argsort(-np.minimum(p, 1 - p), kind="stable")
    if strategy == "least sure":
        return np.argsort(calls.score[members], kind="stable")
    return generator.permutation(len(members))


def checking_report(calls: Calls, labels: Indices, regions: list[Indices]) -> Report:
    report: Report = {}
    for strategy in STRATEGIES:
        generator = np.random.default_rng(SEED)
        curve = []
        for budget in BUDGETS:
            errors = []
            for members in regions:
                order = review_order(strategy, calls, members, generator)
                checked = order[: round(budget * len(members))]
                estimate = calls.chosen[members].copy()
                estimate[checked] = labels[members][checked]
                truth = (labels[members] == TUMOR).mean()
                errors.append(abs((estimate == TUMOR).mean() - truth))
            curve.append({"budget": budget, "mean_error_pp": float(np.mean(errors) * 100)})
        report[strategy] = curve
    return report


def settle_report(calls: Calls, labels: Indices, regions: list[Indices]) -> Report:
    open_cases, settled, settled_right, sizes = 0, 0, 0, []
    for members in regions:
        n = len(members)
        p = calls.tumor[members]
        own = calls.chosen[members] == TUMOR
        truth_labels = labels[members] == TUMOR
        truth = truth_labels.mean()
        weight = np.minimum(p, 1 - p)
        order = np.argsort(-weight, kind="stable")
        order = order[weight[order] > 0]
        for cutoff in CUTOFFS:
            low, high = float(p[own].sum()), float(own.sum() + p[~own].sum())
            if side(low / n, high / n, cutoff) != "either":
                continue
            open_cases += 1
            walk_low, walk_high, k = low, high, 0
            while side(walk_low / n, walk_high / n, cutoff) == "either" and k < len(order):
                index = order[k]
                if own[index]:
                    walk_low += 1 - float(p[index])
                else:
                    walk_high -= float(p[index])
                k += 1
            sizes.append(k / n)
            exact = np.zeros(n, bool)
            exact[order[:k]] = True
            after_p = np.where(exact, truth_labels.astype(np.float64), p)
            after_own = np.where(exact, truth_labels, own)
            answer = side(
                after_p[after_own].sum() / n,
                (after_own.sum() + after_p[~after_own].sum()) / n,
                cutoff,
            )
            if answer != "either":
                settled += 1
                settled_right += int((answer == "above") == (truth >= cutoff))
    return {
        "open_cases": open_cases,
        "settled": settled,
        "settled_right": settled_right,
        "mean_checked_share": float(np.mean(sizes)) if sizes else None,
    }


def auroc(score: NDArray[np.float64], positive: NDArray[np.bool_]) -> float:
    order = np.argsort(score, kind="stable")
    ranks = np.empty(len(score))
    ranks[order] = np.arange(1, len(score) + 1)
    for value in np.unique(score):
        tied = score == value
        ranks[tied] = ranks[tied].mean()
    positives = int(positive.sum())
    negatives = len(score) - positives
    return float(
        (ranks[positive].sum() - positives * (positives + 1) / 2) / (positives * negatives)
    )


def display_report(calls: Calls, labels: Indices, image: Indices) -> Report:
    wrong = calls.chosen != labels
    per_image = {picture: calls.unsure[image == picture].mean() for picture in np.unique(image)}
    map_score = np.asarray([per_image[picture] for picture in image], np.float64)
    faint = calls.score <= np.quantile(calls.score, 0.2)
    return {
        "error_rate": float(wrong.mean()),
        "auroc_fade": auroc(-calls.score, wrong),
        "auroc_bands": auroc(calls.band.astype(np.float64), wrong),
        "auroc_map": auroc(map_score, wrong),
        "auroc_mark": auroc(calls.unsure.astype(np.float64), wrong),
        "faintest_fifth_catches": float(faint[wrong].mean()),
        "unsure_flags": float(calls.unsure.mean()),
        "unsure_flag_wrong": float(wrong[calls.unsure].mean()),
        "unsure_catches": float(calls.unsure[wrong].mean()),
    }


def phrase_of(calls: Calls) -> NDArray[np.str_]:
    return np.where(
        calls.band == 3,
        PHRASES[4],
        np.where(
            calls.close,
            PHRASES[3],
            np.where(
                calls.band == 2, PHRASES[2], np.where(calls.band == 1, PHRASES[1], PHRASES[0])
            ),
        ),
    )


def wording_report(calls: Calls, labels: Indices, tissue: Indices) -> Report:
    phrase = phrase_of(calls)
    first = calls.chosen == labels
    either = first | (calls.other == labels)
    plain = {
        name: {
            "share": float((phrase == name).mean()),
            "first_right": float(first[phrase == name].mean()),
            "either_right": float(either[phrase == name].mean()),
        }
        for name in PHRASES
    }
    stated = [
        round(float(first[calls.band == index].mean()), CATALOGUE_DIGITS)
        for index in range(len(BANDS))
    ]
    gaps = []
    for kind in np.unique(tissue):
        for index in range(len(BANDS)):
            picked = (tissue == kind) & (calls.band == index)
            if picked.sum() < FREQUENCY_MIN_CELLS:
                continue
            actual = first[picked].mean()
            gaps.append(abs(round(actual * 10) - round(stated[index] * 10)))
    return {
        "plain": plain,
        "frequency_cells": len(gaps),
        "frequency_off_by_2_or_more": int(np.sum(np.asarray(gaps) >= 2)),
    }


def warning_report(calls: Calls, labels: Indices, tissue: Indices) -> Report:
    reference_confident = float((calls.band == 0).mean())
    reference_unsure = float((calls.band >= 2).mean())
    rows = []
    for kind in np.unique(tissue):
        picked = tissue == kind
        if picked.sum() < WARN_MIN_TYPED:
            continue
        confident = (calls.band[picked] == 0).mean()
        unsure = (calls.band[picked] >= 2).mean()
        fires = bool(
            reference_confident >= WARN_CONFIDENT_FLOOR
            and confident < reference_confident * WARN_CONFIDENT_RATIO
        ) or bool(unsure > reference_unsure + WARN_UNSURE_EXCESS)
        accuracy = float((calls.chosen[picked] == labels[picked]).mean())
        rows.append((fires, accuracy))
    return {
        "tissues": len(rows),
        "fires_on": sum(int(fires) for fires, _ in rows),
        "worst_quiet_accuracy": min(
            (accuracy for fires, accuracy in rows if not fires), default=None
        ),
    }


def track_record_report(calls: Calls, labels: Indices, regions: list[Indices]) -> Report:
    right = calls.chosen == labels
    reviewed = np.zeros(len(labels), bool)
    for members in regions:
        reviewed[members[calls.unsure[members]]] = True
    by_band = {}
    for index, (name, _) in enumerate(BANDS):
        seen = reviewed & (calls.band == index)
        by_band[name] = {
            "reviewed": int(seen.sum()),
            "kept_when_reviewed": float(right[seen].mean()) if seen.any() else None,
            "right_overall": float(right[calls.band == index].mean()),
        }
    return {
        "accuracy_overall": float(right.mean()),
        "kept_after_unsure_review": float(right[reviewed].mean()),
        "by_band": by_band,
    }


def replay(
    probabilities: NDArray[np.float64],
    labels: Indices,
    image: Indices,
    tissue: Indices,
    temperature: float,
) -> Report:
    calls = calls_of(scaled(probabilities, temperature))
    regions = patch_regions(image, tissue)
    return {
        "temperature": temperature,
        "nuclei": len(labels),
        "regions": len(regions),
        "mean_region_nuclei": float(np.mean([len(members) for members in regions])),
        "ranges": range_report(calls, labels, regions),
        "checking": checking_report(calls, labels, regions),
        "settle": settle_report(calls, labels, regions),
        "displays": display_report(calls, labels, image),
        "wording": wording_report(calls, labels, tissue),
        "warnings": warning_report(calls, labels, tissue),
        "track_record": track_record_report(calls, labels, regions),
    }


def poc_replay(folder: Path, views: int) -> Report:
    nuclei = np.load(folder / "fold3-nuclei.npz")
    fit, fit_labels = poc_split(folder, "train", views)
    test, labels = poc_split(folder, "test", views)
    return replay(
        test,
        labels.astype(np.int64),
        nuclei["image"],
        nuclei["tissue"],
        fit_temperature(fit, fit_labels),
    )


def main(arguments: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m parfocal_ml.confidence_display")
    parser.add_argument("folder", type=Path)
    options = parser.parse_args(arguments)
    report = {f"{views} views": poc_replay(options.folder, views) for views in (1, POC_VIEWS)}
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
