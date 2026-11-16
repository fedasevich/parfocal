import argparse
import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from parfocal_ml.tumor_areas import evaluate_areas, find_tumor_areas
from parfocal_ml.tumor_froc import (
    BUNDLE_SPACING_UM,
    FALSE_POSITIVE_RATES,
    TUMOR_GROUPS,
    SlideHits,
    annotation_polygons,
    detections,
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
    size_errors_mm: tuple[float, ...]
    deposits_missed: int
    stray_areas: int

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
            "size_errors_mm": list(self.size_errors_mm),
            "deposits_missed": self.deposits_missed,
            "stray_areas": self.stray_areas,
        }


def tumor_outlines(groups: dict[str, list[NDArray[np.float64]]]) -> list[list[tuple[float, float]]]:
    return [
        [(float(x), float(y)) for x, y in points]
        for name, found in groups.items()
        if name in TUMOR_GROUPS
        for points in found
    ]


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
    matched = evaluate_areas(areas, tumor_outlines(groups), um_per_px, CELL)
    errors = tuple(d.error_mm for d in matched.deposits if d.error_mm is not None)
    return SlideEvaluation(
        name=name,
        annotated=bool(mask.any()),
        hits=slide_hits(found, lesions),
        lesions_total=int(lesions.labels.max()),
        lesions_isolated=len(lesions.isolated),
        detections=len(found),
        cells=CellCounts(int(called.sum()), int(mask.sum()), int((called & mask).sum())),
        size_errors_mm=errors,
        deposits_missed=sum(1 for d in matched.deposits if d.found_mm is None),
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
        "deposits_measured": len(errors),
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
