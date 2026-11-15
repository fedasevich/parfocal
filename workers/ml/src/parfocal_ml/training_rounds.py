import json
import re
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from parfocal_common.promotion_gate import TENANT_TYPER_ROUND, GateReport, Thresholds, gate
from parfocal_ml.round_calibration import (
    Head,
    RoundCalibration,
    RoundOutputs,
    catalogue_row,
    fits_temperature,
    promote,
    recalibrate,
    train_head,
)
from parfocal_ml.type_evaluation import Labels

MAX_ECE = TENANT_TYPER_ROUND.ceilings["ece"]
MIN_GAIN = -TENANT_TYPER_ROUND.allowed_drop["accuracy"]
ACCURACY_DIGITS = 4
NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")


class NoTrainingExamplesError(ValueError):
    pass


class UnknownRoundError(LookupError):
    pass


@dataclass(frozen=True)
class ReviewedRows:
    features: NDArray[np.floating]
    starts: Mapping[int, NDArray[np.floating]]
    labels: Labels
    slides: Sequence[str]


@dataclass(frozen=True)
class RoundGate:
    max_ece: float = MAX_ECE
    min_gain: float = MIN_GAIN

    def thresholds(self) -> Thresholds:
        return Thresholds(
            task=TENANT_TYPER_ROUND.task,
            benchmark=TENANT_TYPER_ROUND.benchmark,
            source=TENANT_TYPER_ROUND.source,
            allowed_drop={"accuracy": -self.min_gain},
            ceilings={"ece": self.max_ece},
        )


DEFAULT_GATE = RoundGate()


@dataclass(frozen=True)
class RoundReport:
    trained_nuclei: int
    trained_slides: int
    trained_views: int
    served_accuracy: float
    served_version: str
    round_accuracy: float
    calibrations: tuple[dict[str, object], ...]
    refused: tuple[str, ...]
    evaluation: dict[str, object] | None = None


@dataclass(frozen=True)
class TrainingRound:
    tenant: uuid.UUID
    typer: str
    base_version: str
    version: str
    number: int
    head: Head
    report: RoundReport

    @property
    def promoted(self) -> bool:
        return not self.report.refused


@dataclass(frozen=True)
class Pointer:
    latest: str | None = None
    history: tuple[str | None, ...] = field(default_factory=tuple)


class RoundStore(Protocol):
    def numbers(self, tenant: uuid.UUID, typer: str) -> list[int]: ...

    def save(self, found: TrainingRound) -> None: ...

    def load(self, tenant: uuid.UUID, typer: str, version: str) -> TrainingRound: ...

    def pointer(self, tenant: uuid.UUID, typer: str) -> Pointer: ...

    def point(self, tenant: uuid.UUID, typer: str, pointer: Pointer) -> None: ...


def checked_name(name: str) -> str:
    if not NAME.match(name):
        raise ValueError(f"{name!r} is not a typer or version name")
    return name


class FolderStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def folder(self, tenant: uuid.UUID, typer: str) -> Path:
        return self.root / "tenants" / str(tenant) / "typer-rounds" / checked_name(typer)

    def numbers(self, tenant: uuid.UUID, typer: str) -> list[int]:
        folder = self.folder(tenant, typer)
        if not folder.exists():
            return []
        return sorted(
            json.loads((entry / "round.json").read_text())["number"]
            for entry in folder.iterdir()
            if (entry / "round.json").exists()
        )

    def save(self, found: TrainingRound) -> None:
        target = self.folder(found.tenant, found.typer) / checked_name(found.version)
        if target.exists():
            raise FileExistsError(f"{found.version} is already stored")
        target.mkdir(parents=True)
        np.savez(
            target / "head.npz",
            mean=found.head.mean,
            spread=found.head.spread,
            weights=found.head.weights,
            bias=found.head.bias,
        )
        written(
            target / "round.json",
            {
                "tenant": str(found.tenant),
                "typer": found.typer,
                "base_version": found.base_version,
                "version": found.version,
                "number": found.number,
                "report": asdict(found.report),
            },
        )

    def load(self, tenant: uuid.UUID, typer: str, version: str) -> TrainingRound:
        target = self.folder(tenant, typer) / checked_name(version)
        if not (target / "round.json").exists():
            raise UnknownRoundError(f"{typer} {version} is not a round of this tenant")
        stored = json.loads((target / "round.json").read_text())
        weights = np.load(target / "head.npz", allow_pickle=False)
        report = stored["report"]
        return TrainingRound(
            tenant=uuid.UUID(stored["tenant"]),
            typer=stored["typer"],
            base_version=stored["base_version"],
            version=stored["version"],
            number=stored["number"],
            head=Head(weights["mean"], weights["spread"], weights["weights"], weights["bias"]),
            report=RoundReport(
                **{
                    **report,
                    "calibrations": tuple(report["calibrations"]),
                    "refused": tuple(report["refused"]),
                }
            ),
        )

    def pointer(self, tenant: uuid.UUID, typer: str) -> Pointer:
        path = self.folder(tenant, typer) / "latest.json"
        if not path.exists():
            return Pointer()
        stored = json.loads(path.read_text())
        return Pointer(stored["latest"], tuple(stored["history"]))

    def point(self, tenant: uuid.UUID, typer: str, pointer: Pointer) -> None:
        folder = self.folder(tenant, typer)
        folder.mkdir(parents=True, exist_ok=True)
        written(
            folder / "latest.json", {"latest": pointer.latest, "history": list(pointer.history)}
        )


def written(path: Path, content: dict[str, object]) -> None:
    draft = path.with_suffix(".draft")
    draft.write_text(json.dumps(content, indent=2, sort_keys=True))
    draft.replace(path)


def accuracy(probabilities: NDArray[np.floating], labels: Labels) -> float:
    return round(float((probabilities.argmax(axis=1) == labels).mean()), ACCURACY_DIGITS)


def serving(store: RoundStore, tenant: uuid.UUID, typer: str) -> TrainingRound | None:
    latest = store.pointer(tenant, typer).latest
    return None if latest is None else store.load(tenant, typer, latest)


def served_probabilities(
    found: TrainingRound | None, features: NDArray[np.floating], start: NDArray[np.floating]
) -> NDArray[np.float64]:
    if found is None:
        shifted = np.exp(np.asarray(start, np.float64) - start.max(axis=1, keepdims=True))
        return shifted / shifted.sum(axis=1, keepdims=True)
    return found.head(features, start)


def run_round(
    store: RoundStore,
    tenant: uuid.UUID,
    typer: str,
    base_version: str,
    rows: ReviewedRows,
    held_out: Callable[[str], bool],
    served_views: Sequence[int],
    thresholds: RoundGate = DEFAULT_GATE,
) -> TrainingRound:
    checked_name(typer)
    checked_name(base_version)
    labels = np.asarray(rows.labels, np.int64)
    slides = np.asarray(rows.slides, dtype=object)
    features = np.asarray(rows.features, np.float64)
    if not len(labels) == len(slides) == len(features):
        raise ValueError("features, labels and slides must have one row per nucleus")
    missing = sorted(set(served_views) - set(rows.starts))
    if missing:
        raise ValueError(f"no typer output for {missing} views")
    on_held = np.fromiter((held_out(slide) for slide in slides), bool, len(slides))
    if not (~on_held).any():
        raise NoTrainingExamplesError("every reviewed slide is on the held-out side")
    trained_views = min(served_views)
    number = max(store.numbers(tenant, typer), default=0) + 1
    version = f"{base_version}-round-{number}"
    trained_start = np.asarray(rows.starts[trained_views], np.float64)
    head = train_head(
        features[~on_held],
        labels[~on_held],
        trained_start.shape[1],
        trained_start[~on_held],
    )
    held_slides = [str(slide) for slide in slides[on_held]]
    calibrations: list[RoundCalibration] = [
        recalibrate(
            RoundOutputs(
                typer,
                version,
                views,
                head(features[on_held], np.asarray(rows.starts[views], np.float64)[on_held]),
                labels[on_held],
                held_slides,
            ),
            held_out,
        )
        for views in served_views
    ]
    measured = np.fromiter((not fits_temperature(slide) for slide in held_slides), bool)
    measured_features = features[on_held][measured]
    measured_start = trained_start[on_held][measured]
    measured_labels = labels[on_held][measured]
    current = serving(store, tenant, typer)
    served_accuracy = accuracy(
        served_probabilities(current, measured_features, measured_start), measured_labels
    )
    round_accuracy = accuracy(head(measured_features, measured_start), measured_labels)
    evaluation = gated(
        typer, version, calibrations, served_views, round_accuracy, served_accuracy, thresholds
    )
    found = TrainingRound(
        tenant=tenant,
        typer=typer,
        base_version=base_version,
        version=version,
        number=number,
        head=head,
        report=RoundReport(
            trained_nuclei=int((~on_held).sum()),
            trained_slides=len(set(slides[~on_held].tolist())),
            trained_views=trained_views,
            served_accuracy=served_accuracy,
            served_version=base_version if current is None else current.version,
            round_accuracy=round_accuracy,
            calibrations=tuple(catalogue_row(row) for row in calibrations),
            refused=evaluation.refused,
            evaluation=evaluation.as_json(),
        ),
    )
    store.save(found)
    if found.promoted:
        pointer = store.pointer(tenant, typer)
        store.point(tenant, typer, Pointer(version, (*pointer.history, pointer.latest)))
    return found


def gated(
    typer: str,
    version: str,
    calibrations: Sequence[RoundCalibration],
    served_views: Sequence[int],
    round_accuracy: float,
    served_accuracy: float,
    thresholds: RoundGate,
) -> GateReport:
    promote(typer, version, calibrations, served_views)
    worst = max(round(row.calibration.ece_after, ACCURACY_DIGITS) for row in calibrations)
    return gate(
        {"accuracy": round_accuracy, "ece": worst},
        thresholds.thresholds(),
        {"accuracy": served_accuracy},
        "served",
    )


def roll_back(
    store: RoundStore, tenant: uuid.UUID, typer: str, to: str | None = None
) -> str | None:
    pointer = store.pointer(tenant, typer)
    if to is None:
        if not pointer.history:
            raise UnknownRoundError(f"{typer} has no earlier version to roll back to")
        target = pointer.history[-1]
        history = pointer.history[:-1]
    else:
        found = store.load(tenant, typer, to)
        if not found.promoted:
            raise UnknownRoundError(f"{to} was refused at its gate and was never served")
        target = to
        history = (*pointer.history, pointer.latest)
    store.point(tenant, typer, Pointer(target, history))
    return target
