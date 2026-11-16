import argparse
import json
from collections.abc import Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from parfocal_common.node_staging import (
    CELL_LIMIT,
    Area,
    Call,
    Category,
    Cell,
    State,
    stage_node,
)
from parfocal_ml.area_count import count_members
from parfocal_ml.calibration import POC_VIEWS, poc_split
from parfocal_ml.cell_areas import TypedCell
from parfocal_ml.type_evaluation import VIEWER_CLASSES, fit_temperature

SIZES = (300, 400, 500, 600, 800)
CLUSTER_MM = 0.15
NEAR = 50
BREAST = 3
TUMOR = 0
SCALE = 65535

type Indices = NDArray[np.int64]
type Report = dict[str, Any]


@dataclass(frozen=True)
class Nuclei:
    image: Indices
    tissue: Indices
    truth: NDArray[np.bool_]
    tumor_probability: NDArray[np.float64]
    called: NDArray[np.bool_]


@dataclass(frozen=True)
class Outcome:
    tissue: int
    nuclei: int
    images: tuple[int, ...]
    low: float
    value: float
    high: float
    truth: int
    firm: bool
    category: Category
    true_category: Category

    @property
    def wrong(self) -> bool:
        return self.firm and self.category != self.true_category

    @property
    def covered(self) -> bool:
        return self.low <= self.truth <= self.high


def clusters(image: Indices, tissue: Indices, minimum: int) -> list[Indices]:
    found: list[Indices] = []
    for kind in np.unique(tissue):
        members = np.flatnonzero(tissue == kind)
        current: list[int] = []
        for picture in np.unique(image[members]):
            current.extend(np.flatnonzero(image == picture).tolist())
            if len(current) >= minimum:
                found.append(np.asarray(current, dtype=np.int64))
                current = []
    return found


def true_category(count: int) -> Category:
    return Category.MICRO if count > CELL_LIMIT else Category.ITC


def staged_cells(nuclei: Nuclei, members: Indices) -> list[Cell]:
    return [
        Cell(
            tumor_probability=float(nuclei.tumor_probability[index]),
            called_tumor=bool(nuclei.called[index]),
        )
        for index in members.tolist()
    ]


def judge(nuclei: Nuclei, members: Indices) -> Outcome:
    area = Area(
        id="cluster",
        ai_size_mm=CLUSTER_MM,
        call=Call.TUMOR,
        measured_mm=CLUSTER_MM,
        cells=staged_cells(nuclei, members),
    )
    stage = stage_node([area])
    assert stage.count is not None
    truth = int(nuclei.truth[members].sum())
    return Outcome(
        tissue=int(nuclei.tissue[members[0]]),
        nuclei=len(members),
        images=tuple(int(picture) for picture in np.unique(nuclei.image[members])),
        low=stage.count.low,
        value=stage.count.value,
        high=stage.count.high,
        truth=truth,
        firm=stage.state is State.SETTLED,
        category=stage.category,
        true_category=true_category(truth),
    )


def checked_until_firm(nuclei: Nuclei, members: Indices) -> tuple[int, bool, Category]:
    cells = staged_cells(nuclei, members)
    contest = np.minimum(nuclei.tumor_probability[members], 1 - nuclei.tumor_probability[members])
    order = np.argsort(-contest, kind="stable")
    checked = 0
    for position in order.tolist():
        cells[position] = replace(cells[position], checked=bool(nuclei.truth[members[position]]))
        checked += 1
        area = Area("cluster", CLUSTER_MM, Call.TUMOR, CLUSTER_MM, cells)
        stage = stage_node([area])
        if stage.state is State.SETTLED:
            return checked, True, stage.category
    return checked, False, Category.NONE


def describe(outcome: Outcome, size: int) -> Report:
    return {
        "size": size,
        "tissue": outcome.tissue,
        "nuclei": outcome.nuclei,
        "images": [outcome.images[0], outcome.images[-1]],
        "low": round(outcome.low, 2),
        "value": round(outcome.value, 2),
        "high": round(outcome.high, 2),
        "truth": outcome.truth,
    }


def summary(outcomes: Sequence[Outcome]) -> Report:
    firm = [outcome for outcome in outcomes if outcome.firm]
    near = [outcome for outcome in outcomes if abs(outcome.truth - CELL_LIMIT) <= NEAR]
    return {
        "clusters": len(outcomes),
        "true_over_limit": sum(outcome.truth > CELL_LIMIT for outcome in outcomes),
        "firm": len(firm),
        "firm_wrong": sum(outcome.wrong for outcome in outcomes),
        "near": len(near),
        "near_firm": sum(outcome.firm for outcome in near),
        "near_firm_wrong": sum(outcome.wrong for outcome in near),
        "covers_truth": sum(outcome.covered for outcome in outcomes),
        "point_wrong_side": sum(
            true_category(round(outcome.value)) != outcome.true_category for outcome in outcomes
        ),
    }


def report(nuclei: Nuclei) -> Report:
    by_size: dict[str, Report] = {}
    wrong: list[Report] = []
    near_firm: list[Report] = []
    everything: list[Outcome] = []
    breast: list[Outcome] = []
    checking = {"open": 0, "settled": 0, "settled_right": 0, "checked": 0, "checked_share": 0.0}
    for size in SIZES:
        outcomes = []
        for members in clusters(nuclei.image, nuclei.tissue, size):
            outcome = judge(nuclei, members)
            outcomes.append(outcome)
            if outcome.wrong:
                wrong.append(describe(outcome, size))
            elif outcome.firm and abs(outcome.truth - CELL_LIMIT) <= NEAR:
                near_firm.append(describe(outcome, size))
            if not outcome.firm:
                checked, settled, category = checked_until_firm(nuclei, members)
                checking["open"] += 1
                checking["checked"] += checked
                checking["checked_share"] += checked / len(members)
                if settled:
                    checking["settled"] += 1
                    checking["settled_right"] += category == outcome.true_category
        by_size[str(size)] = summary(outcomes)
        everything.extend(outcomes)
        breast.extend(outcome for outcome in outcomes if outcome.tissue == BREAST)
    if checking["open"]:
        checking["checked_share"] = round(checking["checked_share"] / checking["open"], 4)
    return {
        "nuclei": len(nuclei.truth),
        "all": summary(everything),
        "by_size": by_size,
        "breast": summary(breast),
        "wrong_firm": wrong,
        "near_firm_right": near_firm,
        "checking": checking,
    }


def typed_cells(probabilities: NDArray[np.float64]) -> list[TypedCell]:
    return [
        TypedCell(
            x=0.0,
            y=0.0,
            type=VIEWER_CLASSES[int(row.argmax())],
            probabilities=dict(zip(VIEWER_CLASSES, row.tolist(), strict=True)),
        )
        for row in probabilities
    ]


def poc_nuclei(folder: Path, views: int) -> tuple[Nuclei, float]:
    found = np.load(folder / "fold3-nuclei.npz")
    fit, fit_labels = poc_split(folder, "train", views)
    test, labels = poc_split(folder, "test", views)
    temperature = fit_temperature(fit, fit_labels)
    counted = count_members(
        typed_cells(test), np.arange(len(labels), dtype=np.intp), temperature=temperature
    )
    return (
        Nuclei(
            image=found["image"].astype(np.int64),
            tissue=found["tissue"].astype(np.int64),
            truth=labels == TUMOR,
            tumor_probability=np.array([cell.tumor_probability for cell in counted.cells]),
            called=np.array([cell.called_tumor for cell in counted.cells]),
        ),
        temperature,
    )


def quantised(nuclei: Nuclei) -> Nuclei:
    return replace(nuclei, tumor_probability=np.round(nuclei.tumor_probability * SCALE) / SCALE)


def write_fixture(path: Path, by_views: dict[int, Nuclei]) -> None:
    one, many = by_views[1], by_views[POC_VIEWS]
    np.savez_compressed(
        path,
        image=one.image.astype(np.uint16),
        tissue=one.tissue.astype(np.uint8),
        truth=one.truth,
        tumor_1=np.round(one.tumor_probability * SCALE).astype(np.uint16),
        called_1=one.called,
        tumor_8=np.round(many.tumor_probability * SCALE).astype(np.uint16),
        called_8=many.called,
    )


def fixture_nuclei(path: Path, views: int) -> Nuclei:
    data = np.load(path)
    return Nuclei(
        image=data["image"].astype(np.int64),
        tissue=data["tissue"].astype(np.int64),
        truth=data["truth"],
        tumor_probability=data[f"tumor_{views}"].astype(np.float64) / SCALE,
        called=data[f"called_{views}"],
    )


def main(arguments: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m parfocal_ml.staging_validation")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--fixture", type=Path)
    options = parser.parse_args(arguments)
    by_views: dict[int, Nuclei] = {}
    out: Report = {}
    for views in (1, POC_VIEWS):
        nuclei, temperature = poc_nuclei(options.folder, views)
        by_views[views] = nuclei
        exact = report(nuclei)
        rounded = report(quantised(nuclei))
        out[f"{views} views"] = {
            "temperature": temperature,
            "rounding_changes_counts": (exact["by_size"], exact["checking"])
            != (rounded["by_size"], rounded["checking"]),
            **rounded,
        }
    if options.fixture:
        write_fixture(options.fixture, by_views)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
