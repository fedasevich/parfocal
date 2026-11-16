from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

TYPER = "typer"
DETECTOR = "detector"
INTERACTIVE = "interactive-encoder"
TUMOR_MAP = "tumor-map"

TYPER_RESULT = "docs/results/2026-10-18-typing-calibration-reproduction.md"
DETECTOR_RESULT = "docs/results/2026-10-18-geometric-scorer-reproduction.md"
INTERACTIVE_RESULT = "docs/results/2026-11-06-interactive-protocol-on-tnbc.md"
TUMOR_MAP_RESULT = "docs/results/2026-11-16-tumor-map-evaluation-on-three-test-slides.md"
ROUND_ADR = "docs/adr/0319-training-rounds-start-from-the-typer-and-roll-back-by-pointer.md"
MAX_ECE = 0.05
TOLERANCE = 0.01
DIGITS = 4


@dataclass(frozen=True)
class Thresholds:
    task: str
    benchmark: str
    source: str
    baseline: Mapping[str, float] = field(default_factory=dict[str, float])
    allowed_drop: Mapping[str, float] = field(default_factory=dict[str, float])
    ceilings: Mapping[str, float] = field(default_factory=dict[str, float])
    unmeasured: str | None = None

    @property
    def metrics(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys([*self.allowed_drop, *self.ceilings]))


@dataclass(frozen=True)
class GateReport:
    task: str
    benchmark: str
    source: str
    measured: Mapping[str, float]
    reference: Mapping[str, float]
    allowed_drop: Mapping[str, float]
    ceilings: Mapping[str, float]
    refused: tuple[str, ...]

    @property
    def passed(self) -> bool:
        return not self.refused

    def as_json(self) -> dict[str, Any]:
        return {
            "task": self.task,
            "benchmark": self.benchmark,
            "source": self.source,
            "measured": dict(self.measured),
            "reference": dict(self.reference),
            "allowed_drop": dict(self.allowed_drop),
            "ceilings": dict(self.ceilings),
            "refused": list(self.refused),
            "passed": self.passed,
        }


THRESHOLDS: Mapping[str, Thresholds] = {
    TYPER: Thresholds(
        task=TYPER,
        benchmark="PanNuke fold 3, one view, temperature fitted on fold 1",
        source=TYPER_RESULT,
        baseline={"accuracy": 0.8297, "ece": 0.0223},
        allowed_drop={"accuracy": 0.0},
        ceilings={"ece": MAX_ECE},
    ),
    DETECTOR: Thresholds(
        task=DETECTOR,
        benchmark="TNBC, 4,056 nuclei, pathosam-ais-browser",
        source=DETECTOR_RESULT,
        baseline={"pq": 0.8235, "f1": 0.9489},
        allowed_drop={"pq": TOLERANCE, "f1": TOLERANCE},
    ),
    INTERACTIVE: Thresholds(
        task=INTERACTIVE,
        benchmark="TNBC, 3,466 nuclei, mean IoU per prompt",
        source=INTERACTIVE_RESULT,
        baseline={
            "realistic-click": 0.8522,
            "exact-box": 0.8632,
            "loose-box": 0.8169,
            "three-clicks": 0.8806,
        },
        allowed_drop={
            "realistic-click": TOLERANCE,
            "exact-box": TOLERANCE,
            "loose-box": TOLERANCE,
            "three-clicks": TOLERANCE,
        },
    ),
    TUMOR_MAP: Thresholds(
        task=TUMOR_MAP,
        benchmark="CAMELYON16 test_001, test_065 and test_013, pooled lesion FROC and cell Dice",
        source=TUMOR_MAP_RESULT,
        baseline={"froc": 0.7222, "dice": 0.8986},
        allowed_drop={"froc": TOLERANCE, "dice": TOLERANCE},
    ),
}

TENANT_TYPER_ROUND = Thresholds(
    task=TYPER,
    benchmark="measuring half of the tenant's held-out slides",
    source=ROUND_ADR,
    allowed_drop={"accuracy": 0.0},
    ceilings={"ece": MAX_ECE},
)


def gate(
    measured: Mapping[str, float],
    thresholds: Thresholds,
    reference: Mapping[str, float] | None = None,
    reference_name: str = "reference",
) -> GateReport:
    against = dict(thresholds.baseline if reference is None else reference)
    refused: list[str] = []
    if thresholds.unmeasured is not None:
        refused.append(thresholds.unmeasured)
    for metric in thresholds.metrics:
        if metric not in measured:
            refused.append(f"{metric} was not measured")
    for metric, drop in thresholds.allowed_drop.items():
        if metric not in measured:
            continue
        if metric not in against:
            refused.append(f"the {reference_name} has no {metric} to compare with")
            continue
        floor = round(against[metric] - drop, DIGITS)
        if measured[metric] < floor:
            refused.append(
                f"{metric} {measured[metric]} is below the {reference_name}"
                f" {against[metric]} less {drop}"
            )
    for metric, ceiling in thresholds.ceilings.items():
        if metric in measured and measured[metric] > ceiling:
            refused.append(f"{metric} {measured[metric]} is over {ceiling}")
    return GateReport(
        task=thresholds.task,
        benchmark=thresholds.benchmark,
        source=thresholds.source,
        measured=dict(measured),
        reference=against,
        allowed_drop=dict(thresholds.allowed_drop),
        ceilings=dict(thresholds.ceilings),
        refused=tuple(refused),
    )


def gate_model(
    tasks: Iterable[str],
    measured: Mapping[str, Mapping[str, float]],
    reference: Mapping[str, Mapping[str, float]] | None = None,
) -> tuple[GateReport, ...]:
    gated = [task for task in dict.fromkeys(tasks) if task in THRESHOLDS]
    return tuple(
        gate(
            measured.get(task, {}),
            THRESHOLDS[task],
            None if reference is None or task not in reference else reference[task],
        )
        for task in gated
    )


def passed(reports: Iterable[GateReport]) -> bool:
    found = list(reports)
    return bool(found) and all(report.passed for report in found)
