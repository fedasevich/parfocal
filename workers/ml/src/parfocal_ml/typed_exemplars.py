import argparse
import io
import json
import platform
import sys
import tempfile
import time
import zipfile
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import numpy as np
from numpy.typing import NDArray
from skimage import draw

from parfocal_ml.ais_region import Maps, OnnxAis, typescript_rings, write_maps
from parfocal_ml.datasets import (
    PANNUKE_CLASSES,
    REGISTRY,
    Sample,
    cache_dir,
    fetch,
    member,
    samples,
)
from parfocal_ml.exemplar_search import pooled, prototype, token_coverage, unit
from parfocal_ml.sam_contract import GRAPHS, pixel_values

FOLD = "pannuke-fold1"
SEED = 20261117
TILES = 448
TILE_SIDE = 256
SHOTS = 3
DRAWS = 20
KS = (10, 50)
MATCH_IOU = 0.5
CHUNK = 16
UNMATCHED = "unmatched"
SOURCES = ("detected", "truth")
POOLS = ("all", "other mosaics")
RANKINGS = ("tokens", "colour", "random")


@dataclass(frozen=True)
class Features:
    vectors: NDArray[np.float64]
    colours: NDArray[np.float64]
    kinds: NDArray[np.str_]
    mosaics: NDArray[np.int64]

    def __len__(self) -> int:
        return len(self.kinds)


def mosaic(tiles: Sequence[Sample]) -> Sample:
    if len(tiles) != 4:
        raise ValueError("a mosaic takes four tiles")
    side = tiles[0].rgb.shape[0]
    rgb = np.zeros((side * 2, side * 2, 3), np.uint8)
    labels = np.zeros((side * 2, side * 2), np.int32)
    classes: dict[int, str] = {}
    offset = 0
    for index, tile in enumerate(tiles):
        if tile.rgb.shape[:2] != (side, side):
            raise ValueError("mosaic tiles must share one square size")
        row, col = divmod(index, 2)
        window = (slice(row * side, (row + 1) * side), slice(col * side, (col + 1) * side))
        rgb[window] = tile.rgb[..., :3]
        labels[window] = np.where(tile.labels > 0, tile.labels + offset, 0)
        for label, kind in (tile.classes or {}).items():
            classes[label + offset] = kind
        offset += int(tile.labels.max())
    return Sample(
        name="+".join(tile.name for tile in tiles),
        rgb=rgb,
        labels=labels,
        ignore=None,
        group="+".join(str(tile.group) for tile in tiles),
        classes=classes,
    )


def rasterised(rings: Iterable[Sequence[float]], side: int) -> list[NDArray[np.bool_]]:
    masks: list[NDArray[np.bool_]] = []
    for ring in rings:
        points = np.asarray(ring, np.float64).reshape(-1, 2)
        rows, cols = draw.polygon(points[:, 1], points[:, 0], shape=(side, side))
        mask = np.zeros((side, side), bool)
        mask[rows, cols] = True
        if mask.any():
            masks.append(mask)
    return masks


def matched_kind(
    labels: NDArray[np.int32], classes: dict[int, str], mask: NDArray[np.bool_]
) -> str:
    counts = np.bincount(labels[mask], minlength=1)
    counts[0] = 0
    label = int(np.argmax(counts))
    if counts[label] == 0:
        return UNMATCHED
    union = int(mask.sum()) + int((labels == label).sum()) - int(counts[label])
    if counts[label] / union < MATCH_IOU:
        return UNMATCHED
    return classes.get(label, UNMATCHED)


def truth_masks(sample: Sample) -> list[tuple[NDArray[np.bool_], str]]:
    classes = sample.classes or {}
    return [
        (sample.labels == label, classes[label])
        for label in np.unique(sample.labels).tolist()
        if label in classes
    ]


def features_of(
    embedding: NDArray[np.floating],
    rgb: NDArray[np.uint8],
    masks: Sequence[tuple[NDArray[np.bool_], str]],
    mosaic_id: int,
) -> Features:
    vectors: list[NDArray[np.float64]] = []
    colours: list[NDArray[np.float64]] = []
    kinds: list[str] = []
    for mask, kind in masks:
        coverage = token_coverage(mask)
        if coverage.sum() == 0:
            continue
        vectors.append(pooled(embedding, coverage))
        colours.append(rgb[..., :3][mask].astype(np.float64).mean(axis=0))
        kinds.append(kind)
    width = int(np.asarray(embedding).shape[-3])
    return Features(
        vectors=np.asarray(vectors, np.float64).reshape(-1, width),
        colours=np.asarray(colours, np.float64).reshape(-1, 3),
        kinds=np.asarray(kinds, dtype=np.str_),
        mosaics=np.full(len(kinds), mosaic_id, np.int64),
    )


def joined(parts: Sequence[Features]) -> Features:
    return Features(
        vectors=np.concatenate([part.vectors for part in parts]),
        colours=np.concatenate([part.colours for part in parts]),
        kinds=np.concatenate([part.kinds for part in parts]),
        mosaics=np.concatenate([part.mosaics for part in parts]),
    )


def precision_at(hits: NDArray[np.bool_], k: int) -> float:
    if len(hits) < k:
        return float("nan")
    return float(hits[:k].mean())


def exemplars_for(
    features: Features, kind: str, rng: np.random.Generator
) -> NDArray[np.int64] | None:
    of_kind = features.kinds == kind
    counts = np.bincount(features.mosaics[of_kind], minlength=int(features.mosaics.max()) + 1)
    eligible = np.flatnonzero(counts >= SHOTS)
    if len(eligible) == 0:
        return None
    source = int(rng.choice(eligible))
    candidates = np.flatnonzero(of_kind & (features.mosaics == source))
    return np.sort(rng.choice(candidates, size=SHOTS, replace=False))


def orders(
    features: Features, chosen: NDArray[np.int64], pool: NDArray[np.int64], rng: np.random.Generator
) -> dict[str, NDArray[np.int64]]:
    centre = prototype([features.vectors[index] for index in chosen])
    token_scores = unit(features.vectors[pool]) @ centre
    colour = features.colours[chosen].mean(axis=0)
    colour_scores = -np.linalg.norm(features.colours[pool] - colour, axis=1)
    return {
        "tokens": pool[np.argsort(-token_scores, kind="stable")],
        "colour": pool[np.argsort(-colour_scores, kind="stable")],
        "random": rng.permutation(pool),
    }


def pool_of(features: Features, chosen: NDArray[np.int64], name: str) -> NDArray[np.int64]:
    keep = np.ones(len(features), bool)
    keep[chosen] = False
    if name == "other mosaics":
        keep &= features.mosaics != features.mosaics[chosen[0]]
    return np.flatnonzero(keep)


@dataclass(frozen=True)
class KindResult:
    kind: str
    positives: int
    draws: int
    prevalence: dict[str, float]
    precision: dict[str, dict[str, dict[int, float]]]
    own_mosaic_in_top: dict[int, float]


def evaluate(features: Features, kind: str, rng: np.random.Generator) -> KindResult:
    positives = int((features.kinds == kind).sum())
    collected: dict[str, dict[str, dict[int, list[float]]]] = {
        pool: {ranking: {k: [] for k in KS} for ranking in RANKINGS} for pool in POOLS
    }
    prevalence: dict[str, list[float]] = {pool: [] for pool in POOLS}
    own: dict[int, list[float]] = {k: [] for k in KS}
    draws = 0
    for _ in range(DRAWS):
        chosen = exemplars_for(features, kind, rng)
        if chosen is None:
            break
        draws += 1
        source = features.mosaics[chosen[0]]
        for pool_name in POOLS:
            pool = pool_of(features, chosen, pool_name)
            prevalence[pool_name].append(float((features.kinds[pool] == kind).mean()))
            for ranking, order in orders(features, chosen, pool, rng).items():
                hits = features.kinds[order] == kind
                for k in KS:
                    collected[pool_name][ranking][k].append(precision_at(hits, k))
                if pool_name == "all" and ranking == "tokens":
                    for k in KS:
                        own[k].append(float((features.mosaics[order[:k]] == source).mean()))
    return KindResult(
        kind=kind,
        positives=positives,
        draws=draws,
        prevalence={pool: mean(values) for pool, values in prevalence.items()},
        precision={
            pool: {
                ranking: {k: mean(values) for k, values in by_k.items()}
                for ranking, by_k in by_ranking.items()
            }
            for pool, by_ranking in collected.items()
        },
        own_mosaic_in_top={k: mean(values) for k, values in own.items()},
    )


def mean(values: Sequence[float]) -> float:
    finite = [value for value in values if np.isfinite(value)]
    return round(float(np.mean(finite)), 4) if finite else float("nan")


def fold_size(path: Path) -> int:
    with zipfile.ZipFile(path) as archive:
        (types,) = member(archive, r"/types\.npy$")
        return len(np.load(io.BytesIO(archive.read(types))))


def subset(name: str, tiles: int, rng: np.random.Generator) -> list[Sample]:
    total = fold_size(fetch(REGISTRY[name]))
    picked = rng.permutation(total)[:tiles]
    position = {int(index): order for order, index in enumerate(picked)}
    chosen: list[Sample | None] = [None] * tiles
    for index, sample in enumerate(samples(name)):
        if index in position:
            chosen[position[index]] = sample
    return [sample for sample in chosen if sample is not None]


def encode(
    model: OnnxAis, rgb: NDArray[np.uint8]
) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    started = time.perf_counter()
    name = model.encoder.get_inputs()[0].name
    embedding = cast("NDArray[np.float32]", model.encoder.run(None, {name: pixel_values(rgb)})[0])
    model.encode_ms.append((time.perf_counter() - started) * 1000)
    started = time.perf_counter()
    maps = cast("NDArray[np.float32]", model.ais.run(None, {"image_embeddings": embedding})[0])
    model.ais_ms.append((time.perf_counter() - started) * 1000)
    return embedding, np.ascontiguousarray(maps[0], dtype=np.float32)


def extract(model: OnnxAis, mosaics: Sequence[Sample]) -> dict[str, Features]:
    parts: dict[str, list[Features]] = {source: [] for source in SOURCES}
    for start in range(0, len(mosaics), CHUNK):
        batch = mosaics[start : start + CHUNK]
        embeddings: list[NDArray[np.float32]] = []
        with tempfile.TemporaryDirectory(prefix="parfocal-typed-") as scratch:
            folder = Path(scratch)
            entries: list[Maps] = []
            for sample in batch:
                embedding, maps = encode(model, sample.rgb)
                embeddings.append(embedding)
                entries.append(Maps(sample.name, maps))
            write_maps(folder, entries)
            rings = typescript_rings(folder)
        for offset, (sample, embedding) in enumerate(zip(batch, embeddings, strict=True)):
            mosaic_id = start + offset
            side = sample.labels.shape[0]
            classes = sample.classes or {}
            detected = [
                (mask, matched_kind(sample.labels, classes, mask))
                for mask in rasterised(rings[sample.name][0], side)
            ]
            parts["detected"].append(features_of(embedding, sample.rgb, detected, mosaic_id))
            parts["truth"].append(
                features_of(embedding, sample.rgb, truth_masks(sample), mosaic_id)
            )
        print(f"{start + len(batch)} of {len(mosaics)} mosaics", file=sys.stderr, flush=True)
    return {source: joined(values) for source, values in parts.items()}


def saved(path: Path, features: dict[str, Features]) -> None:
    arrays: dict[str, Any] = {}
    for source, values in features.items():
        arrays[f"{source}_vectors"] = values.vectors
        arrays[f"{source}_colours"] = values.colours
        arrays[f"{source}_kinds"] = values.kinds
        arrays[f"{source}_mosaics"] = values.mosaics
    np.savez(path, **arrays)


def loaded(path: Path) -> dict[str, Features]:
    with np.load(path) as arrays:
        return {
            source: Features(
                vectors=arrays[f"{source}_vectors"],
                colours=arrays[f"{source}_colours"],
                kinds=arrays[f"{source}_kinds"],
                mosaics=arrays[f"{source}_mosaics"],
            )
            for source in SOURCES
        }


def report_of(features: dict[str, Features]) -> dict[str, object]:
    rng = np.random.default_rng(SEED + 1)
    report: dict[str, object] = {}
    for source, values in features.items():
        kinds, counts = np.unique(values.kinds, return_counts=True)
        report[source] = {
            "nuclei": len(values),
            "kinds": {str(kind): int(count) for kind, count in zip(kinds, counts, strict=True)},
            "results": [evaluate(values, kind, rng).__dict__ for kind in PANNUKE_CLASSES],
        }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Rank typed PanNuke nuclei by exemplar tokens")
    parser.add_argument("--fold", default=FOLD)
    parser.add_argument("--tiles", type=int, default=TILES)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--out", type=Path, default=cache_dir() / "typed-exemplars")
    parser.add_argument("--rescore", action="store_true")
    arguments = parser.parse_args()
    arguments.out.mkdir(parents=True, exist_ok=True)
    path = arguments.out / f"{arguments.fold}-{arguments.tiles}.npz"
    started = time.perf_counter()
    environment: dict[str, object] = {
        "machine": f"{platform.machine()} {platform.platform()}",
        "python": platform.python_version(),
    }
    if arguments.rescore:
        features = loaded(path)
    else:
        rng = np.random.default_rng(SEED)
        tiles = subset(arguments.fold, arguments.tiles - arguments.tiles % 4, rng)
        tissues, tissue_counts = np.unique([str(tile.group) for tile in tiles], return_counts=True)
        environment["tissues"] = {
            str(tissue): int(count) for tissue, count in zip(tissues, tissue_counts, strict=True)
        }
        mosaics = [mosaic(tiles[start : start + 4]) for start in range(0, len(tiles), 4)]
        del tiles
        model = OnnxAis(
            GRAPHS.encoder_uint8, GRAPHS.ais_decoder_int8_weights, threads=arguments.threads
        )
        features = extract(model, mosaics)
        saved(path, features)
        environment["mosaics"] = len(mosaics)
        environment["encode_ms_median"] = round(float(np.median(model.encode_ms)), 1)
        environment["ais_ms_median"] = round(float(np.median(model.ais_ms)), 1)
    report = {
        "fold": arguments.fold,
        "tiles": arguments.tiles,
        "seed": SEED,
        "shots": SHOTS,
        "draws": DRAWS,
        "match_iou": MATCH_IOU,
        "environment": environment,
        **report_of(features),
        "seconds": round(time.perf_counter() - started, 1),
    }
    (arguments.out / f"{arguments.fold}-{arguments.tiles}.json").write_text(
        json.dumps(report, indent=2)
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
