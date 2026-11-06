import argparse
import itertools
import json
import platform
import sys
import time
import zlib
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, cast

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage
from skimage import measure

from parfocal_ml.datasets import Sample, cache_dir, samples
from parfocal_ml.sam_contract import GRAPHS, MASK_INPUT_SIZE, onnx_dir, pixel_values, scaled_point
from parfocal_ml.scoring import SUPERSAMPLE, fill, upsample

if TYPE_CHECKING:
    import onnxruntime as ort

MIN_AREA = 20
EDGE = 3
CLICK_SPREAD = 0.35
CLICK_TRIES = 50
BOX_LOOSE = 0.05
BOX_SPREAD = 0.10
REFINE_EVERY = 4
REFINE_CLICKS = 3
NOC_CAP = 20
NOC_TARGETS = (0.85, 0.90)
GOOD_CLICK = 0.75
COARSE_ABOVE = 128 * 128
SIMPLIFY_PX = 0.2
TOLERANCE = 0.01
MODES = ("ideal_click", "realistic_click", "exact_box", "loose_box", "two_clicks", "three_clicks")
DOC26_TNBC: dict[str, float] = {
    "ideal_click": 0.8514,
    "realistic_click": 0.8514,
    "exact_box": 0.8632,
    "loose_box": 0.8167,
    "two_clicks": 0.8737,
    "three_clicks": 0.8842,
}
DOC26_TNBC_PROMPTED = 3466
DOC26_TNBC_REFINED = 858

type Point = tuple[int, int]
type Box = tuple[int, int, int, int]
type Ring = list[float]
type Logits = NDArray[np.float32]


@dataclass(frozen=True)
class Instance:
    id: int
    area: int
    window: tuple[slice, slice]
    ideal: Point
    realistic: Point
    box: Box
    loose: Box


@dataclass(frozen=True)
class Prompt:
    positives: tuple[Point, ...] = ()
    negatives: tuple[Point, ...] = ()
    box: Box | None = None


class Prompter(Protocol):
    def __call__(self, prompt: Prompt, previous: Logits | None) -> Logits: ...


class Model(Protocol):
    def prepare(self, rgb: NDArray[np.uint8]) -> Prompter: ...


@dataclass
class Outcome:
    image: str
    id: int
    area: int
    ious: dict[str, float]
    trajectory: list[float] = field(default_factory=list[float])

    def clicks_to(self, target: float) -> int | None:
        if not self.trajectory:
            return None
        for step, value in enumerate(self.trajectory, start=1):
            if value >= target:
                return step
        return NOC_CAP


def ideal_click(inside: NDArray[np.bool_]) -> Point:
    depth = ndimage.distance_transform_edt(np.pad(inside, 1))
    depth = cast("NDArray[np.float64]", depth)[1:-1, 1:-1]
    y, x = np.unravel_index(int(np.argmax(depth)), depth.shape)
    return int(x), int(y)


def realistic_click(inside: NDArray[np.bool_], rng: np.random.Generator, fallback: Point) -> Point:
    ys, xs = np.nonzero(inside)
    centre_x, centre_y = float(xs.mean()), float(ys.mean())
    spread = CLICK_SPREAD * float(np.sqrt(len(xs) / np.pi))
    for _ in range(CLICK_TRIES):
        x = round(centre_x + rng.normal(0, spread))
        y = round(centre_y + rng.normal(0, spread))
        if 0 <= y < inside.shape[0] and 0 <= x < inside.shape[1] and inside[y, x]:
            return x, y
    return fallback


def loose_box(box: Box, width: int, height: int, rng: np.random.Generator) -> Box:
    x0, y0, x1, y1 = box
    side_x, side_y = x1 - x0 + 1, y1 - y0 + 1
    left = round(x0 - rng.normal(BOX_LOOSE * side_x, BOX_SPREAD * side_x))
    top = round(y0 - rng.normal(BOX_LOOSE * side_y, BOX_SPREAD * side_y))
    right = round(x1 + rng.normal(BOX_LOOSE * side_x, BOX_SPREAD * side_x))
    bottom = round(y1 + rng.normal(BOX_LOOSE * side_y, BOX_SPREAD * side_y))
    return (
        min(max(0, left), x1 - 1),
        min(max(0, top), y1 - 1),
        max(min(width - 1, right), x0 + 1),
        max(min(height - 1, bottom), y0 + 1),
    )


def instances(name: str, labels: NDArray[np.int32]) -> list[Instance]:
    height, width = labels.shape
    rng = np.random.default_rng(zlib.crc32(name.encode()))
    found: list[Instance] = []
    for number, window in enumerate(ndimage.find_objects(labels), start=1):
        if window is None:
            continue
        rows, cols = window
        inside = labels[rows, cols] == number
        area = int(inside.sum())
        box = (int(cols.start), int(rows.start), int(cols.stop) - 1, int(rows.stop) - 1)
        on_edge = (
            box[0] < EDGE or box[1] < EDGE or box[2] >= width - EDGE or box[3] >= height - EDGE
        )
        if area < MIN_AREA or on_edge:
            continue
        ideal = ideal_click(inside)
        realistic = realistic_click(inside, rng, ideal)
        found.append(
            Instance(
                id=number,
                area=area,
                window=(rows, cols),
                ideal=(ideal[0] + box[0], ideal[1] + box[1]),
                realistic=(realistic[0] + box[0], realistic[1] + box[1]),
                box=box,
                loose=loose_box(box, width, height, rng),
            )
        )
    return found


def resampled(logits: Logits, height: int, width: int) -> NDArray[np.float32]:
    source_height, source_width = logits.shape

    def taps(
        size: int, source: int
    ) -> tuple[NDArray[np.intp], NDArray[np.intp], NDArray[np.float32]]:
        position = np.clip((np.arange(size) + 0.5) * source / size - 0.5, 0, source - 1)
        low = np.floor(position).astype(np.intp)
        high = np.minimum(low + 1, source - 1)
        return low, high, (position - low).astype(np.float32)

    top, bottom, down = taps(height, source_height)
    left, right, across = taps(width, source_width)
    rows = logits[top] * (1 - down)[:, None] + logits[bottom] * down[:, None]
    return (rows[:, left] * (1 - across) + rows[:, right] * across).astype(np.float32)


def largest_loop(contours: Iterable[NDArray[np.float64]]) -> NDArray[np.float64] | None:
    best: NDArray[np.float64] | None = None
    best_area = 0.0
    for contour in contours:
        ys, xs = contour[:, 0], contour[:, 1]
        area = abs(float(np.dot(xs, np.roll(ys, -1)) - np.dot(ys, np.roll(xs, -1)))) / 2
        if area > best_area:
            best, best_area = contour, area
    return best


def ring_of(field: NDArray[np.float32], seed: Point | None) -> Ring | None:
    components, count = cast("tuple[NDArray[np.int32], int]", ndimage.label(field > 0))
    if count == 0:
        return None
    wanted = 0
    if seed is not None and 0 <= seed[1] < field.shape[0] and 0 <= seed[0] < field.shape[1]:
        wanted = int(components[seed[1], seed[0]])
    if wanted == 0:
        wanted = 1 + int(np.argmax(np.bincount(components.ravel())[1:]))
    rows, cols = cast("tuple[slice, slice]", ndimage.find_objects(components)[wanted - 1])
    top, left = rows.start - 1, cols.start - 1
    height, width = rows.stop - rows.start + 2, cols.stop - cols.start + 2
    window = np.full((height, width), -1.0, np.float32)
    own = np.zeros((height, width), bool)
    src_top, src_left = max(0, top), max(0, left)
    src_bottom = min(field.shape[0], top + height)
    src_right = min(field.shape[1], left + width)
    target = (slice(src_top - top, src_bottom - top), slice(src_left - left, src_right - left))
    window[target] = field[src_top:src_bottom, src_left:src_right]
    own[target] = components[src_top:src_bottom, src_left:src_right] == wanted
    values = np.where(own, window, np.minimum(window, -1e-3))
    contour = largest_loop(measure.find_contours(np.pad(values, 1, constant_values=-1.0), 0.0))
    if contour is None:
        return None
    simplified = measure.approximate_polygon(contour, SIMPLIFY_PX)
    if len(simplified) > 1 and np.array_equal(simplified[0], simplified[-1]):
        simplified = simplified[:-1]
    if len(simplified) < 3:
        return None
    points = np.stack([simplified[:, 1] + left - 1, simplified[:, 0] + top - 1], axis=1)
    return [float(value) for value in points.ravel()]


def score_ring(ring: Ring | None, labels: NDArray[np.int32], instance: Instance) -> float:
    if not ring:
        return 0.0
    rows, cols = instance.window
    xs, ys = ring[0::2], ring[1::2]
    x0 = max(0, min(cols.start, int(np.floor(min(xs)))) - 1)
    y0 = max(0, min(rows.start, int(np.floor(min(ys)))) - 1)
    x1 = max(cols.stop - 1, int(np.ceil(max(xs))))
    y1 = max(rows.stop - 1, int(np.ceil(max(ys))))
    region = labels[y0 : y1 + 2, x0 : x1 + 2] == instance.id
    scale = SUPERSAMPLE if region.size <= COARSE_ABOVE else 1
    truth = upsample(region, scale)
    shifted = [value - (x0 if index % 2 == 0 else y0) for index, value in enumerate(ring)]
    predicted = np.zeros(truth.shape, bool)
    predicted[fill(shifted, (int(truth.shape[0]), int(truth.shape[1])), scale)] = True
    union = int(np.logical_or(predicted, truth).sum())
    return float(np.logical_and(predicted, truth).sum() / union) if union else 0.0


def rasterised(ring: Ring | None, shape: tuple[int, int]) -> NDArray[np.bool_]:
    mask = np.zeros(shape, bool)
    if ring:
        mask[fill(ring, shape, 1)] = True
    return mask


def next_click(truth: NDArray[np.bool_], predicted: NDArray[np.bool_]) -> tuple[Point, bool] | None:
    def depth(region: NDArray[np.bool_]) -> NDArray[np.float64]:
        return cast("NDArray[np.float64]", ndimage.distance_transform_edt(np.pad(region, 1)))[
            1:-1, 1:-1
        ]

    missed = depth(truth & ~predicted)
    extra = depth(predicted & ~truth)
    if missed.max() == 0 and extra.max() == 0:
        return None
    positive = bool(missed.max() >= extra.max())
    chosen = missed if positive else extra
    y, x = np.unravel_index(int(np.argmax(chosen)), chosen.shape)
    return (int(x), int(y)), positive


def evaluate(sample: Sample, prompter: Prompter, *, noc: bool = True) -> list[Outcome]:
    labels = sample.labels
    shape = (int(labels.shape[0]), int(labels.shape[1]))
    outcomes: list[Outcome] = []

    def run(
        prompt: Prompt, instance: Instance, previous: Logits | None = None
    ) -> tuple[Logits, Ring | None, float]:
        logits = prompter(prompt, previous)
        seed = prompt.positives[0] if prompt.positives else None
        ring = ring_of(resampled(logits, *shape), seed)
        return logits, ring, score_ring(ring, labels, instance)

    for instance in instances(sample.name, labels):
        ious: dict[str, float] = {}
        ious["ideal_click"] = run(Prompt(positives=(instance.ideal,)), instance)[2]
        logits, ring, first = run(Prompt(positives=(instance.realistic,)), instance)
        ious["realistic_click"] = first
        ious["exact_box"] = run(Prompt(box=instance.box), instance)[2]
        ious["loose_box"] = run(Prompt(box=instance.loose), instance)[2]
        outcome = Outcome(image=sample.name, id=instance.id, area=instance.area, ious=ious)
        outcomes.append(outcome)
        if instance.id % REFINE_EVERY != 0:
            continue
        truth = labels == instance.id
        positives: list[Point] = [instance.realistic]
        negatives: list[Point] = []
        trajectory = [first]
        cap = NOC_CAP if noc else REFINE_CLICKS
        for step in range(2, cap + 1):
            if step > REFINE_CLICKS and trajectory[-1] >= max(NOC_TARGETS):
                break
            click = next_click(truth, rasterised(ring, shape))
            if click is None:
                break
            (positives if click[1] else negatives).append(click[0])
            prompt = Prompt(positives=tuple(positives), negatives=tuple(negatives))
            logits, ring, value = run(prompt, instance, logits)
            trajectory.append(value)
        if len(trajectory) > 1:
            ious["two_clicks"] = trajectory[1]
        if len(trajectory) > 2:
            ious["three_clicks"] = trajectory[2]
        if noc:
            outcome.trajectory = trajectory
    return outcomes


@dataclass(frozen=True)
class Mean:
    mean: float
    se: float
    count: int


def mean_of(values: Sequence[float]) -> Mean:
    array = np.asarray(values, np.float64)
    if len(array) == 0:
        return Mean(0.0, 0.0, 0)
    se = float(array.std(ddof=1) / np.sqrt(len(array))) if len(array) > 1 else 0.0
    return Mean(round(float(array.mean()), 4), round(se, 4), len(array))


def summarise(outcomes: Sequence[Outcome]) -> dict[str, object]:
    modes = {mode: mean_of([o.ious[mode] for o in outcomes if mode in o.ious]) for mode in MODES}
    noc: dict[str, object] = {}
    traced = [o for o in outcomes if o.trajectory]
    for target in NOC_TARGETS:
        clicks = [cast("int", o.clicks_to(target)) for o in traced]
        reached = [o.clicks_to(target) for o in traced if max(o.trajectory) >= target]
        noc[f"{round(target * 100)}"] = {
            "mean": round(float(np.mean(clicks)), 3) if clicks else 0.0,
            "never": round(1 - len(reached) / len(traced), 4) if traced else 0.0,
            "count": len(traced),
        }
    realistic = [o.ious["realistic_click"] for o in outcomes]
    return {
        "nuclei": len(outcomes),
        "modes": {mode: asdict(value) for mode, value in modes.items()},
        "noc": noc,
        "noc_cap": NOC_CAP,
        "realistic_at_least_075": round(float(np.mean(np.asarray(realistic) >= GOOD_CLICK)), 4)
        if realistic
        else 0.0,
    }


def compare(
    summary: dict[str, object], baseline: dict[str, float], tolerance: float = TOLERANCE
) -> dict[str, dict[str, object]]:
    modes = cast("dict[str, dict[str, float]]", summary["modes"])
    return {
        mode: {
            "ours": modes[mode]["mean"],
            "doc26": expected,
            "difference": round(modes[mode]["mean"] - expected, 4),
            "within": abs(modes[mode]["mean"] - expected) <= tolerance,
        }
        for mode, expected in baseline.items()
    }


class OnnxSam:
    def __init__(self, encoder: str, folder: Path | None = None, threads: int = 0) -> None:
        import onnxruntime as ort

        root = folder or onnx_dir()
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        providers = ["CPUExecutionProvider"]
        self.encoder: ort.InferenceSession = ort.InferenceSession(
            str(root / encoder), options, providers=providers
        )
        self.decoder: ort.InferenceSession = ort.InferenceSession(
            str(root / GRAPHS.decoder), options, providers=providers
        )
        self.encode_ms: list[float] = []
        self.decode_ms: list[float] = []

    def prepare(self, rgb: NDArray[np.uint8]) -> Prompter:
        height, width = int(rgb.shape[0]), int(rgb.shape[1])
        if height != width:
            raise ValueError("the decoder graph is traced square")
        started = time.perf_counter()
        name = self.encoder.get_inputs()[0].name
        embeddings = cast(
            "NDArray[np.float32]", self.encoder.run(None, {name: pixel_values(rgb)})[0]
        )
        self.encode_ms.append((time.perf_counter() - started) * 1000)

        def prompter(prompt: Prompt, previous: Logits | None) -> Logits:
            return self.decode(embeddings, height, width, prompt, previous)

        return prompter

    def decode(
        self,
        embeddings: NDArray[np.float32],
        height: int,
        width: int,
        prompt: Prompt,
        previous: Logits | None,
    ) -> Logits:
        points = [(x, y, 1.0) for x, y in prompt.positives] + [
            (x, y, 0.0) for x, y in prompt.negatives
        ]
        if prompt.box is not None:
            points += [(prompt.box[0], prompt.box[1], 2.0), (prompt.box[2], prompt.box[3], 3.0)]
        else:
            points.append((0, 0, -1.0))
        coords = [
            scaled_point(x, y, height, width) if label >= 0 else (0.0, 0.0)
            for x, y, label in points
        ]
        feeds = {
            "image_embeddings": embeddings,
            "point_coords": np.array([coords], np.float32),
            "point_labels": np.array([[label for _, _, label in points]], np.float32),
            "mask_input": (
                previous[None, None].astype(np.float32)
                if previous is not None
                else np.zeros((1, 1, MASK_INPUT_SIZE, MASK_INPUT_SIZE), np.float32)
            ),
            "has_mask_input": np.array([1.0 if previous is not None else 0.0], np.float32),
            "orig_im_size": np.array([height, width], np.float32),
        }
        started = time.perf_counter()
        scores, low_res = cast(
            "list[NDArray[np.float32]]",
            self.decoder.run(["iou_predictions", "low_res_masks"], feeds),
        )
        self.decode_ms.append((time.perf_counter() - started) * 1000)
        return low_res[0, int(np.argmax(scores[0]))].copy()


def run(
    model: Model, images: Iterable[Sample], sink: Path | None = None, *, noc: bool = True
) -> Iterator[Outcome]:
    handle = sink.open("w") if sink else None
    try:
        for sample in images:
            for outcome in evaluate(sample, model.prepare(sample.rgb), noc=noc):
                if handle:
                    handle.write(json.dumps(asdict(outcome)) + "\n")
                yield outcome
            if handle:
                handle.flush()
    finally:
        if handle:
            handle.close()


def poc_means(scores: Path, names: set[str] | None = None) -> dict[str, float]:
    modes = {
        ("click", 1): "ideal_click",
        ("click-j", 1): "realistic_click",
        ("box", 1): "exact_box",
        ("box-j", 1): "loose_box",
        ("refine", 2): "two_clicks",
        ("refine", 3): "three_clicks",
    }
    values: dict[str, list[float]] = {mode: [] for mode in modes.values()}
    for line in scores.read_text().splitlines():
        record = json.loads(line)
        mode = modes.get((record["mode"], record["step"]))
        if mode and (names is None or record["image"] in names):
            values[mode].append(float(record["iou"]))
    return {mode: round(float(np.mean(found)), 4) for mode, found in values.items() if found}


def median(values: Sequence[float]) -> float:
    return round(float(np.median(values)), 1) if values else 0.0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the interactive protocol of POC doc 26 on TNBC"
    )
    parser.add_argument("--images", type=int, default=None)
    parser.add_argument("--encoder", default=GRAPHS.encoder_uint8)
    parser.add_argument("--threads", type=int, default=0)
    parser.add_argument("--out", type=Path, default=cache_dir() / "interactive")
    arguments = parser.parse_args()
    import onnxruntime as ort

    arguments.out.mkdir(parents=True, exist_ok=True)
    model = OnnxSam(arguments.encoder, threads=arguments.threads)
    started = time.perf_counter()
    images = itertools.islice(samples("tnbc"), arguments.images)
    outcomes = list(run(model, images, arguments.out / "nuclei.jsonl"))
    summary = summarise(outcomes)
    report = {
        "dataset": "tnbc",
        "images": len({o.image for o in outcomes}),
        "encoder": arguments.encoder,
        "decoder": GRAPHS.decoder,
        "summary": summary,
        "doc26": compare(summary, DOC26_TNBC) if arguments.images is None else None,
        "tolerance": TOLERANCE,
        "seconds": round(time.perf_counter() - started, 1),
        "encode_ms_median": median(model.encode_ms),
        "decode_ms_median": median(model.decode_ms),
        "decodes": len(model.decode_ms),
        "versions": {
            "onnxruntime": ort.__version__,
            "numpy": np.__version__,
            "python": platform.python_version(),
        },
        "machine": f"{platform.machine()} {platform.platform()}",
    }
    (arguments.out / "summary.json").write_text(json.dumps(report, indent=2))
    json.dump(report, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
