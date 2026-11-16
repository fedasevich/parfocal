import argparse
import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import numpy as np
from numpy.typing import NDArray
from skimage import measure

from parfocal_ml.tumor_areas import Point, TumorArea, area_labels, find_tumor_areas, outline_mm
from parfocal_ml.tumor_froc import (
    BUNDLE_SPACING_UM,
    FALSE_POSITIVE_RATES,
    TUMOR_GROUPS,
    Lesions,
    SlideHits,
    annotation_polygons,
    detections,
    filled,
    froc,
    lesions_of,
    slide_hits,
    tumor_mask,
)
from parfocal_ml.tumor_map import CELL, decoded

DICE_AT = 0.5

type Grid = NDArray[np.floating[Any]]
type Mask = NDArray[np.bool_]


@dataclass(frozen=True)
class CellCounts:
    called: int
    truth: int
    both: int

    @property
    def dice(self) -> float | None:
        total = self.called + self.truth
        return 2 * self.both / total if total else None

    @property
    def sensitivity(self) -> float | None:
        return self.both / self.truth if self.truth else None


@dataclass(frozen=True)
class SlideEvaluation:
    name: str
    annotated: bool
    hits: SlideHits
    lesions_total: int
    lesions_isolated: int
    detections: int
    cells: CellCounts
    deposits: tuple[LesionSize, ...]
    stray_areas: int

    @property
    def size_errors_mm(self) -> tuple[float, ...]:
        return tuple(d.error_mm for d in self.deposits if d.error_mm is not None)

    @property
    def deposits_missed(self) -> int:
        return sum(1 for d in self.deposits if d.found_mm is None and not d.merged)

    @property
    def deposits_merged(self) -> int:
        return sum(1 for d in self.deposits if d.merged)

    def as_json(self) -> dict[str, Any]:
        single = froc([self.hits]) if self.hits.lesions else None
        return {
            "slide": self.name,
            "annotated": self.annotated,
            "froc": single.score if single else None,
            "lesions_total": self.lesions_total,
            "lesions_isolated": self.lesions_isolated,
            "lesions_counted": self.hits.lesions,
            "lesions_hit": sum(1 for p in self.hits.true_positives if p > 0),
            "detections": self.detections,
            "false_positives": len(self.hits.false_positives),
            "hit_probs": sorted(self.hits.true_positives, reverse=True),
            "top_false_positive": max(self.hits.false_positives, default=None),
            "dice": self.cells.dice,
            "sensitivity": self.cells.sensitivity,
            "called_cells": self.cells.called,
            "tumor_cells": self.cells.truth,
            "deposits": [
                {
                    "truth_mm": d.truth_mm,
                    "found_mm": d.found_mm,
                    "areas": d.areas,
                    "isolated": d.isolated,
                    "merged": d.merged,
                }
                for d in self.deposits
            ],
            "size_errors_mm": list(self.size_errors_mm),
            "deposits_missed": self.deposits_missed,
            "deposits_merged": self.deposits_merged,
            "stray_areas": self.stray_areas,
        }


@dataclass(frozen=True)
class LesionSize:
    truth_mm: float
    found_mm: float | None
    areas: int
    isolated: bool
    merged: bool = False

    @property
    def error_mm(self) -> float | None:
        return None if self.found_mm is None else self.found_mm - self.truth_mm

    @property
    def truth_over_found(self) -> float | None:
        return self.truth_mm / self.found_mm if self.found_mm else None


@dataclass(frozen=True)
class LesionMatch:
    deposits: tuple[LesionSize, ...]
    stray: tuple[TumorArea, ...]


def deposit_labels(mask: Mask) -> NDArray[np.int32]:
    return cast("NDArray[np.int32]", measure.label(mask, connectivity=2)).astype(np.int32)


def deposit_outlines(
    groups: dict[str, list[NDArray[np.float64]]], deposits: NDArray[np.int32], cell: float
) -> dict[int, list[Point]]:
    merged: dict[int, list[Point]] = {}
    for name, found in groups.items():
        if name not in TUMOR_GROUPS:
            continue
        for points in found:
            inside = deposits[filled([points], deposits.shape, cell)]
            inside = inside[inside > 0]
            if inside.size:
                label = int(np.bincount(inside).argmax())
                merged.setdefault(label, []).extend((float(x), float(y)) for x, y in points)
    return merged


def match_deposits(
    areas: Sequence[TumorArea],
    area_cells: NDArray[np.int32],
    deposits: NDArray[np.int32],
    lesions: Lesions,
    outlines: dict[int, list[Point]],
    um_per_px: float,
) -> LesionMatch:
    credited: dict[int, list[TumorArea]] = {}
    touched: set[int] = set()
    for area in areas:
        under = deposits[area_cells == area.label]
        under = under[under > 0]
        if under.size:
            credited.setdefault(int(np.bincount(under).argmax()), []).append(area)
            touched.update(np.unique(under).tolist())
    used = {area.label for found in credited.values() for area in found}
    sizes: list[LesionSize] = []
    for label in sorted(outlines, key=lambda key: -outline_mm(outlines[key], um_per_px)):
        own = credited.get(label, [])
        lesion = int(lesions.labels[deposits == label].max())
        sizes.append(
            LesionSize(
                outline_mm(outlines[label], um_per_px),
                max((area.longest_mm for area in own), default=None),
                len(own),
                lesion in lesions.isolated,
                merged=not own and label in touched,
            )
        )
    lesion_cells = lesions.labels > 0
    stray = tuple(
        area
        for area in areas
        if area.label not in used and not (lesion_cells & (area_cells == area.label)).any()
    )
    return LesionMatch(tuple(sizes), stray)


def evaluate_slide(
    name: str,
    probability: Grid,
    xml: Path | None,
    cell_um: float = BUNDLE_SPACING_UM * CELL,
) -> SlideEvaluation:
    groups = annotation_polygons(xml) if xml else {}
    mask: Mask = tumor_mask(groups, probability.shape, CELL)
    lesions = lesions_of(mask, cell_um)
    found = detections(probability)
    called = probability >= DICE_AT
    height, width = probability.shape
    um_per_px = cell_um / CELL
    areas = find_tumor_areas(probability, (0, 0, width * CELL, height * CELL), um_per_px)
    area_cells, _ = area_labels(probability)
    deposits = deposit_labels(mask)
    matched = match_deposits(
        areas, area_cells, deposits, lesions, deposit_outlines(groups, deposits, CELL), um_per_px
    )
    return SlideEvaluation(
        name=name,
        annotated=bool(mask.any()),
        hits=slide_hits(found, lesions),
        lesions_total=int(lesions.labels.max()),
        lesions_isolated=len(lesions.isolated),
        detections=len(found),
        cells=CellCounts(int(called.sum()), int(mask.sum()), int((called & mask).sum())),
        deposits=matched.deposits,
        stray_areas=len(matched.stray),
    )


def summary(slides: Sequence[SlideEvaluation]) -> dict[str, Any]:
    annotated = [s for s in slides if s.annotated]
    normal = [s for s in slides if not s.annotated]
    pooled = froc([s.hits for s in annotated]) if any(s.hits.lesions for s in annotated) else None
    counts = CellCounts(
        sum(s.cells.called for s in annotated),
        sum(s.cells.truth for s in annotated),
        sum(s.cells.both for s in annotated),
    )
    errors = [e for s in annotated for e in s.size_errors_mm]
    per_slide = [d for s in annotated if (d := s.cells.dice) is not None]
    return {
        "slides": len(slides),
        "annotated_slides": len(annotated),
        "normal_slides": len(normal),
        "froc": pooled.score if pooled else None,
        "sensitivities": (
            dict(zip(map(str, FALSE_POSITIVE_RATES), pooled.sensitivities, strict=True))
            if pooled
            else None
        ),
        "lesions_counted": pooled.lesions if pooled else 0,
        "false_positives_on_annotated": pooled.false_positives if pooled else 0,
        "dice": counts.dice,
        "mean_slide_dice": float(np.mean(per_slide)) if per_slide else None,
        "mean_abs_size_error_mm": float(np.mean(np.abs(errors))) if errors else None,
        "median_abs_size_error_mm": float(np.median(np.abs(errors))) if errors else None,
        "deposits_measured": len(errors),
        "deposits_missed": sum(s.deposits_missed for s in annotated),
        "deposits_merged": sum(s.deposits_merged for s in annotated),
        "truth_over_found": (
            [float(min(ratios)), float(max(ratios))]
            if (ratios := [r for s in annotated for d in s.deposits if (r := d.truth_over_found)])
            else None
        ),
        "stray_areas_on_annotated": sum(s.stray_areas for s in annotated),
        "false_positives_on_normal": sum(len(s.hits.false_positives) for s in normal),
        "stray_areas_on_normal": sum(s.stray_areas for s in normal),
    }


def gate_metrics(report: dict[str, Any]) -> dict[str, float]:
    return {key: float(report[key]) for key in ("froc", "dice") if report.get(key) is not None}


def main(arguments: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="FROC and Dice of stored tumor maps against CAMELYON16 outlines"
    )
    parser.add_argument("maps", type=Path, help="folder with one <slide>/stored.npy per slide")
    parser.add_argument("fixtures", type=Path, help="folder with the <slide>.xml outlines")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(arguments)
    slides = []
    for stored in sorted(args.maps.glob("*/stored.npy")):
        name = stored.parent.name
        xml = args.fixtures / f"{name}.xml"
        probability = decoded(np.load(stored))
        slides.append(evaluate_slide(name, probability, xml if xml.exists() else None))
    report = {"summary": summary(slides), "slides": [s.as_json() for s in slides]}
    text = json.dumps(report, indent=2)
    if args.out:
        args.out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
