import argparse
import json
import platform
import sys
import time
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import cast

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage
from skimage import measure

from parfocal_ml.datasets import Sample, cache_dir, samples
from parfocal_ml.prompt_region import OnnxPrompt
from parfocal_ml.sam_contract import EMBED_SIZE, IMAGE_SIZE
from parfocal_ml.scoring import ImageScore, score_image, summarise

ENCODER = "pathosam.encoder_uint8.onnx"
DECODER = "pathosam.decoder.onnx"
SEED = 20261116
DRAWS = 5
SHOTS = (1, 3, 5)
TUNING_IMAGES = 10
THRESHOLDS = tuple(round(value, 2) for value in np.arange(0.30, 0.96, 0.01))
PEAK_CELLS = 3
MIN_EXEMPLAR_AREA = 80
MIN_MASK_AREA = 20
MAX_MASK_AREA = 7238
MIN_MASK_SCORE = 0.7
DUPLICATE_IOU = 0.5
INSIDE = 0.5

type Embedding = NDArray[np.float32]
type Vector = NDArray[np.float64]


def token_coverage(mask: NDArray[np.bool_], side: int = EMBED_SIZE) -> NDArray[np.float64]:
    height, width = mask.shape
    if height != width or height % side:
        raise ValueError("the image must be square and a multiple of the token grid")
    cell = height // side
    return mask.reshape(side, cell, side, cell).mean(axis=(1, 3))


def unit(vectors: NDArray[np.floating]) -> NDArray[np.float64]:
    values = np.asarray(vectors, np.float64)
    norms = np.linalg.norm(values, axis=0 if values.ndim == 3 else -1, keepdims=True)
    return values / np.maximum(norms, 1e-12)


def planes_of(embedding: NDArray[np.floating]) -> NDArray[np.float64]:
    planes = np.asarray(embedding, np.float64)
    return planes[0] if planes.ndim == 4 else planes


def pooled(embedding: NDArray[np.floating], coverage: NDArray[np.float64]) -> Vector:
    planes = unit(planes_of(embedding))
    weights = coverage.reshape(-1)
    if weights.sum() == 0:
        raise ValueError("the mask covers no token")
    return cast("Vector", planes.reshape(planes.shape[0], -1) @ weights / weights.sum())


def prototype(vectors: Sequence[Vector]) -> Vector:
    return cast("Vector", unit(np.mean(np.stack([unit(v) for v in vectors]), axis=0)))


def similarity_map(embedding: NDArray[np.floating], centre: Vector) -> NDArray[np.float64]:
    planes = unit(planes_of(embedding))
    return np.tensordot(unit(centre), planes, axes=(0, 0))


def peaks(similarity: NDArray[np.float64], threshold: float) -> list[tuple[int, int]]:
    top = ndimage.maximum_filter(similarity, size=PEAK_CELLS, mode="nearest")
    rows, cols = np.nonzero((similarity >= top) & (similarity >= threshold))
    order = np.argsort(-similarity[rows, cols], kind="stable")
    return [(int(rows[i]), int(cols[i])) for i in order]


def auroc(positive: Sequence[float], negative: Sequence[float]) -> float:
    pos = np.asarray(positive, np.float64)
    neg = np.asarray(negative, np.float64)
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    combined = np.concatenate([pos, neg])
    order = combined.argsort(kind="stable")
    ranked = np.empty(len(combined), np.float64)
    ranked[order] = np.arange(1, len(combined) + 1)
    for value in np.unique(combined):
        tied = combined == value
        if tied.sum() > 1:
            ranked[tied] = ranked[tied].mean()
    return float((ranked[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def cell_pixels(image_side: int) -> float:
    return image_side / EMBED_SIZE


def seed_hits(
    labels: NDArray[np.int32], seeds: Sequence[tuple[int, int]], excluded: set[int]
) -> tuple[int, int, int]:
    cell = cell_pixels(labels.shape[0])
    found: set[int] = set()
    background = 0
    duplicate = 0
    for row, col in seeds:
        label = int(labels[int((row + 0.5) * cell), int((col + 0.5) * cell)])
        if label == 0:
            background += 1
        elif label in excluded:
            continue
        elif label in found:
            duplicate += 1
        else:
            found.add(label)
    return len(found), background, duplicate


@dataclass(frozen=True)
class Image:
    name: str
    labels: NDArray[np.int32]
    ignore: NDArray[np.bool_] | None
    rgb: NDArray[np.uint8]
    embedding: Embedding
    vectors: dict[int, Vector]
    areas: dict[int, int]
    colours: dict[int, Vector]


def nuclei_of(sample: Sample, embedding: Embedding) -> Image:
    labels = sample.labels
    side = labels.shape[0]
    if side * 2 != IMAGE_SIZE:
        raise ValueError("the bench expects 512 px images")
    vectors: dict[int, Vector] = {}
    areas: dict[int, int] = {}
    colours: dict[int, Vector] = {}
    for label in np.unique(labels).tolist():
        if label == 0:
            continue
        mask = labels == label
        if sample.ignore is not None and sample.ignore[mask].mean() > 0.5:
            continue
        coverage = token_coverage(mask)
        if coverage.sum() == 0:
            continue
        vectors[label] = pooled(embedding, coverage)
        areas[label] = int(mask.sum())
        colours[label] = sample.rgb[..., :3][mask].astype(np.float64).mean(axis=0)
    return Image(sample.name, labels, sample.ignore, sample.rgb, embedding, vectors, areas, colours)


def choose(image: Image, shots: int, rng: np.random.Generator, pool: Sequence[int]) -> list[int]:
    candidates = [label for label in pool if image.areas[label] >= MIN_EXEMPLAR_AREA]
    if len(candidates) < shots + 1:
        return []
    return [int(label) for label in rng.choice(candidates, size=shots, replace=False)]


@dataclass(frozen=True)
class Retrieval:
    shots: int
    draws: int
    nucleus_vs_background: list[float]
    large_vs_small_tokens: list[float]
    large_vs_small_colour: list[float]


def tertiles(image: Image) -> tuple[list[int], list[int]]:
    labels = sorted(image.vectors, key=lambda label: image.areas[label])
    third = len(labels) // 3
    return labels[:third], labels[-third:] if third else []


def background_scores(image: Image, centre: Vector) -> tuple[list[float], list[float]]:
    similarity = similarity_map(image.embedding, centre)
    coverage = token_coverage(image.labels > 0)
    ignored = (
        token_coverage(image.ignore) > 0
        if image.ignore is not None
        else np.zeros_like(coverage, bool)
    )
    inside = similarity[(coverage >= INSIDE) & ~ignored].tolist()
    outside = similarity[(coverage == 0) & ~ignored].tolist()
    return inside, outside


def retrieval(images: Sequence[Image], shots: int, rng: np.random.Generator) -> Retrieval:
    versus_background: list[float] = []
    by_tokens: list[float] = []
    by_colour: list[float] = []
    draws = 0
    for image in images:
        small, large = tertiles(image)
        for _ in range(DRAWS):
            exemplars = choose(image, shots, rng, list(image.vectors))
            if exemplars:
                centre = prototype([image.vectors[label] for label in exemplars])
                inside, outside = background_scores(image, centre)
                versus_background.append(auroc(inside, outside))
            chosen = choose(image, shots, rng, large)
            if not chosen or not small:
                continue
            draws += 1
            centre = prototype([image.vectors[label] for label in chosen])
            rest_large = [label for label in large if label not in chosen]
            score = {label: float(unit(image.vectors[label]) @ centre) for label in image.vectors}
            by_tokens.append(
                auroc([score[label] for label in rest_large], [score[label] for label in small])
            )
            colour = np.mean([image.colours[label] for label in chosen], axis=0)
            near = {
                label: -float(np.linalg.norm(image.colours[label] - colour))
                for label in image.vectors
            }
            by_colour.append(
                auroc([near[label] for label in rest_large], [near[label] for label in small])
            )
    return Retrieval(shots, draws, versus_background, by_tokens, by_colour)


@dataclass(frozen=True)
class SeedCount:
    threshold: float
    found: int
    nuclei: int
    background: int
    duplicate: int
    seeds: int


def seed_counts(
    images: Sequence[Image], exemplars: dict[str, list[int]], thresholds: Sequence[float]
) -> list[SeedCount]:
    totals = {threshold: [0, 0, 0, 0, 0] for threshold in thresholds}
    for image in images:
        chosen = exemplars[image.name]
        if not chosen:
            continue
        centre = prototype([image.vectors[label] for label in chosen])
        similarity = similarity_map(image.embedding, centre)
        nuclei = len([label for label in image.vectors if label not in chosen])
        for threshold in thresholds:
            seeds = peaks(similarity, threshold)
            found, background, duplicate = seed_hits(image.labels, seeds, set(chosen))
            total = totals[threshold]
            total[0] += found
            total[1] += nuclei
            total[2] += background
            total[3] += duplicate
            total[4] += len(seeds)
    return [SeedCount(threshold, *values) for threshold, values in totals.items()]


def seed_f1(count: SeedCount) -> float:
    if count.found == 0:
        return 0.0
    recall = count.found / count.nuclei
    precision = count.found / max(1, count.found + count.background + count.duplicate)
    return 2 * recall * precision / (recall + precision)


def ring_of(mask: NDArray[np.bool_]) -> list[float] | None:
    labelled = np.asarray(measure.label(mask, connectivity=1), np.int64)
    if labelled.max() == 0:
        return None
    sizes = np.bincount(labelled.ravel())
    sizes[0] = 0
    largest = labelled == int(np.argmax(sizes))
    contours = measure.find_contours(np.pad(largest, 1).astype(np.float64), 0.5)
    if not contours:
        return None
    contour = max(contours, key=len) - 1
    return [float(value) for point in contour[:, ::-1] for value in point]


def decoded(
    model: OnnxPrompt, points: Sequence[tuple[float, float]], side: int
) -> list[list[float]]:
    kept: list[tuple[float, NDArray[np.bool_]]] = []
    scale = IMAGE_SIZE / side
    for x, y in points:
        logits, score = model.best_mask(x * scale, y * scale)
        if score < MIN_MASK_SCORE:
            continue
        mask = logits[::2, ::2] > 0 if logits.shape[0] == side * 2 else logits > 0
        area = int(mask.sum())
        if area < MIN_MASK_AREA or area > MAX_MASK_AREA:
            continue
        if any(overlap(mask, other) > DUPLICATE_IOU for _, other in kept):
            continue
        kept.append((score, mask))
    rings = [ring_of(mask) for _, mask in kept]
    return [ring for ring in rings if ring is not None]


def overlap(a: NDArray[np.bool_], b: NDArray[np.bool_]) -> float:
    union = int(np.logical_or(a, b).sum())
    return float(np.logical_and(a, b).sum() / union) if union else 0.0


def excluded_ignore(image: Image, chosen: Sequence[int]) -> NDArray[np.bool_]:
    mask = np.isin(image.labels, list(chosen))
    return mask | image.ignore if image.ignore is not None else mask


def centroids(image: Image, chosen: Sequence[int]) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for label in image.vectors:
        if label in chosen:
            continue
        rows, cols = np.nonzero(image.labels == label)
        points.append((float(cols.mean()) + 0.5, float(rows.mean()) + 0.5))
    return points


@dataclass(frozen=True)
class EndToEnd:
    name: str
    images: int
    summary: dict[str, object]
    decodes: int


def end_to_end(
    model: OnnxPrompt,
    images: Sequence[Image],
    exemplars: dict[str, list[int]],
    threshold: float,
) -> tuple[EndToEnd, EndToEnd]:
    searched: list[ImageScore] = []
    oracle: list[ImageScore] = []
    searched_decodes = 0
    oracle_decodes = 0
    for image in images:
        chosen = exemplars[image.name]
        if not chosen:
            continue
        side = image.labels.shape[0]
        cell = cell_pixels(side)
        model.embeddings = image.embedding
        centre = prototype([image.vectors[label] for label in chosen])
        seeds = peaks(similarity_map(image.embedding, centre), threshold)
        points = [((col + 0.5) * cell, (row + 0.5) * cell) for row, col in seeds]
        ignore = excluded_ignore(image, chosen)
        searched_decodes += len(points)
        searched.append(score_image(image.labels, decoded(model, points, side), ignore))
        truth_points = centroids(image, chosen)
        oracle_decodes += len(truth_points)
        oracle.append(score_image(image.labels, decoded(model, truth_points, side), ignore))
    return (
        EndToEnd("exemplar search", len(searched), asdict(summarise(searched)), searched_decodes),
        EndToEnd(
            "prompt at every true centroid", len(oracle), asdict(summarise(oracle)), oracle_decodes
        ),
    )


def spread(values: Sequence[float]) -> dict[str, float]:
    finite = np.asarray([v for v in values if np.isfinite(v)], np.float64)
    if len(finite) == 0:
        return {"n": 0}
    return {
        "n": len(finite),
        "mean": round(float(finite.mean()), 4),
        "p10": round(float(np.percentile(finite, 10)), 4),
        "p90": round(float(np.percentile(finite, 90)), 4),
    }


def encoded(model: OnnxPrompt, sample: Sample, folder: Path) -> Embedding:
    path = folder / f"{sample.name.replace('/', '_')}.npy"
    if path.exists():
        return cast("Embedding", np.load(path))
    model.encode(sample.rgb[..., :3])
    embedding = cast("Embedding", model.embeddings)
    np.save(path, embedding)
    return embedding


def main() -> int:
    parser = argparse.ArgumentParser(description="Score exemplar search on TNBC")
    parser.add_argument("--images", type=int, default=None)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--embeddings", type=Path, default=cache_dir() / "exemplar-embeddings")
    parser.add_argument("--skip-decode", action="store_true")
    args = parser.parse_args()
    args.embeddings.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    model = OnnxPrompt(ENCODER, DECODER, threads=args.threads)
    images: list[Image] = []
    for index, sample in enumerate(samples("tnbc")):
        if args.images is not None and index >= args.images:
            break
        images.append(nuclei_of(sample, encoded(model, sample, args.embeddings)))
    rng = np.random.default_rng(SEED)
    report: dict[str, object] = {
        "environment": f"{platform.platform()} Python {sys.version.split()[0]}",
        "encoder": ENCODER,
        "images": len(images),
        "nuclei": sum(len(image.vectors) for image in images),
    }
    report["retrieval"] = [
        {
            "shots": result.shots,
            "draws": result.draws,
            "nucleus_vs_background": spread(result.nucleus_vs_background),
            "large_vs_small_tokens": spread(result.large_vs_small_tokens),
            "large_vs_small_colour": spread(result.large_vs_small_colour),
        }
        for result in (retrieval(images, shots, rng) for shots in SHOTS)
    ]
    exemplars = {image.name: choose(image, 3, rng, list(image.vectors)) for image in images}
    tuning, held_out = images[:TUNING_IMAGES], images[TUNING_IMAGES:]
    tuned = max(seed_counts(tuning, exemplars, THRESHOLDS), key=seed_f1)
    report["threshold"] = tuned.threshold
    report["tuning_seeds"] = asdict(tuned) | {"f1": round(seed_f1(tuned), 4)}
    held = seed_counts(held_out, exemplars, [tuned.threshold])[0]
    report["held_out_seeds"] = asdict(held) | {"f1": round(seed_f1(held), 4)}
    if not args.skip_decode:
        search, oracle = end_to_end(model, held_out, exemplars, tuned.threshold)
        report["end_to_end"] = [asdict(search), asdict(oracle)]
    report["seconds"] = round(time.perf_counter() - started, 1)
    report["median_encode_ms"] = (
        round(float(np.median(model.encode_ms)), 1) if model.encode_ms else None
    )
    report["median_decode_ms"] = (
        round(float(np.median(model.decode_ms)), 1) if model.decode_ms else None
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
