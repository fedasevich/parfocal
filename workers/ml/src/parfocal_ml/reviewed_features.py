import uuid
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from parfocal_ml.training_rounds import ReviewedRows, checked_name

STARTS = "starts-"


@dataclass(frozen=True)
class ReviewedNucleus:
    slide: str
    task: str
    kind: str
    number: int
    reviewer: str
    final_class: str | None
    rejected: bool = False

    @property
    def key(self) -> str:
        return f"{self.task}:{self.kind}:{self.number}"


@dataclass(frozen=True)
class Pooled:
    features: NDArray[np.floating]
    starts: Mapping[int, NDArray[np.floating]]


type Pooler = Callable[[str, Sequence[ReviewedNucleus]], Pooled]


@dataclass(frozen=True)
class SlideFeatures:
    keys: tuple[str, ...]
    features: NDArray[np.float32]
    starts: Mapping[int, NDArray[np.float32]]


@dataclass(frozen=True)
class Collected:
    pooled: int
    stored: int


@dataclass(frozen=True)
class Assembled:
    rows: ReviewedRows
    keys: tuple[tuple[str, str], ...]
    conflicted: int
    unpooled: int


class FeatureStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def folder(self, tenant: uuid.UUID, typer: str, base_version: str) -> Path:
        return (
            self.root
            / "tenants"
            / str(tenant)
            / "typer-features"
            / checked_name(typer)
            / checked_name(base_version)
        )

    def slides(self, tenant: uuid.UUID, typer: str, base_version: str) -> list[str]:
        folder = self.folder(tenant, typer, base_version)
        if not folder.exists():
            return []
        return sorted(entry.stem for entry in folder.glob("*.npz") if ".draft" not in entry.name)

    def load(
        self, tenant: uuid.UUID, typer: str, base_version: str, slide: str
    ) -> SlideFeatures | None:
        path = self.folder(tenant, typer, base_version) / f"{checked_name(slide)}.npz"
        if not path.exists():
            return None
        with np.load(path, allow_pickle=False) as stored:
            return SlideFeatures(
                keys=tuple(str(key) for key in stored["keys"]),
                features=stored["features"],
                starts={
                    int(name.removeprefix(STARTS)): stored[name]
                    for name in stored.files
                    if name.startswith(STARTS)
                },
            )

    def save(
        self, tenant: uuid.UUID, typer: str, base_version: str, slide: str, found: SlideFeatures
    ) -> None:
        folder = self.folder(tenant, typer, base_version)
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / f"{checked_name(slide)}.npz"
        draft = folder / f"{slide}.draft.npz"
        arrays: dict[str, NDArray[np.generic]] = {
            "keys": np.asarray(found.keys, dtype=np.str_),
            "features": found.features,
        }
        arrays.update({f"{STARTS}{views}": start for views, start in found.starts.items()})
        np.savez(draft, allow_pickle=False, **arrays)
        draft.replace(target)


def merged(old: SlideFeatures | None, keys: Sequence[str], pooled: Pooled) -> SlideFeatures:
    features = np.asarray(pooled.features, np.float32)
    starts = {views: np.asarray(start, np.float32) for views, start in pooled.starts.items()}
    if len(features) != len(keys) or any(len(start) != len(keys) for start in starts.values()):
        raise ValueError("the pooler must return one row per nucleus")
    if old is None:
        return SlideFeatures(tuple(keys), features, starts)
    if set(old.starts) != set(starts):
        raise ValueError("the pooler returned other view counts than the stored ones")
    if old.features.shape[1] != features.shape[1]:
        raise ValueError("the pooler returned another feature width than the stored one")
    return SlideFeatures(
        (*old.keys, *keys),
        np.vstack([old.features, features]),
        {views: np.vstack([old.starts[views], start]) for views, start in starts.items()},
    )


def collect(
    store: FeatureStore,
    tenant: uuid.UUID,
    typer: str,
    base_version: str,
    nuclei: Sequence[ReviewedNucleus],
    pool: Pooler,
) -> Collected:
    by_slide: dict[str, dict[str, ReviewedNucleus]] = defaultdict(dict)
    for nucleus in nuclei:
        if not nucleus.rejected:
            by_slide[nucleus.slide].setdefault(nucleus.key, nucleus)
    pooled = 0
    for slide in sorted(by_slide):
        old = store.load(tenant, typer, base_version, slide)
        known = set() if old is None else set(old.keys)
        waiting = [nucleus for key, nucleus in sorted(by_slide[slide].items()) if key not in known]
        if not waiting:
            continue
        found = merged(old, [nucleus.key for nucleus in waiting], pool(slide, waiting))
        store.save(tenant, typer, base_version, slide, found)
        pooled += len(waiting)
    stored = 0
    for slide in store.slides(tenant, typer, base_version):
        loaded = store.load(tenant, typer, base_version, slide)
        stored += 0 if loaded is None else len(loaded.keys)
    return Collected(pooled, stored)


def agreed_labels(
    nuclei: Sequence[ReviewedNucleus], classes: Mapping[str, int]
) -> tuple[dict[tuple[str, str], int], int]:
    votes: dict[tuple[str, str], set[int | None]] = defaultdict(set)
    for nucleus in nuclei:
        label = None if nucleus.rejected else classes.get(nucleus.final_class or "")
        votes[(nucleus.slide, nucleus.key)].add(label)
    agreed = {}
    conflicted = 0
    for place, labels in votes.items():
        if len(labels) > 1:
            conflicted += 1
            continue
        (label,) = labels
        if label is not None:
            agreed[place] = label
    return agreed, conflicted


def assemble(
    store: FeatureStore,
    tenant: uuid.UUID,
    typer: str,
    base_version: str,
    nuclei: Sequence[ReviewedNucleus],
    classes: Mapping[str, int],
    served_views: Sequence[int],
) -> Assembled:
    agreed, conflicted = agreed_labels(nuclei, classes)
    keys: list[tuple[str, str]] = []
    features: list[NDArray[np.float32]] = []
    starts: dict[int, list[NDArray[np.float32]]] = {views: [] for views in served_views}
    labels: list[int] = []
    for slide in sorted({slide for slide, _ in agreed}):
        stored = store.load(tenant, typer, base_version, slide)
        if stored is None:
            continue
        missing = sorted(set(served_views) - set(stored.starts))
        if missing:
            raise ValueError(f"{slide} has no typer output for {missing} views")
        for row, key in enumerate(stored.keys):
            label = agreed.get((slide, key))
            if label is None:
                continue
            keys.append((slide, key))
            features.append(stored.features[row])
            for views in served_views:
                starts[views].append(stored.starts[views][row])
            labels.append(label)
    if not keys:
        raise ValueError("no reviewed nucleus has pooled features yet")
    rows = ReviewedRows(
        features=np.vstack(features),
        starts={views: np.vstack(rows) for views, rows in starts.items()},
        labels=np.asarray(labels, np.int64),
        slides=[slide for slide, _ in keys],
    )
    return Assembled(rows, tuple(keys), conflicted, len(agreed) - len(keys))
