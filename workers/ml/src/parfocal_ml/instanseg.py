import argparse
import itertools
import json
import platform
import sys
import time
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import cast

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from parfocal_ml.datasets import Sample, cache_dir, samples
from parfocal_ml.exemplar_search import ring_of
from parfocal_ml.sam_contract import models_dir
from parfocal_ml.scoring import ImageScore, Summary, score_image, summarise

MODEL_MICRONS_PER_PIXEL = 0.5
DATASET_MICRONS_PER_PIXEL = {"tnbc": 0.25, "monuseg-test": 0.25}
LOW_PERCENTILE = 0.1
HIGH_PERCENTILE = 99.9
RELEASE = "instanseg_models_v0.1.1"
WEIGHTS = "brightfield_nuclei"

type Segmenter = Callable[[NDArray[np.float32]], NDArray[np.int32]]


@dataclass(frozen=True)
class InstanSegRun:
    summary: Summary
    images: int
    input_side: list[int]
    segment_ms: list[float]


def model_dir() -> Path:
    return models_dir() / "instanseg" / RELEASE.rsplit("_", 1)[-1]


def normalise(rgb: NDArray[np.uint8]) -> NDArray[np.float32]:
    channels = np.moveaxis(rgb[..., :3].astype(np.float32), -1, 0)
    low = np.percentile(channels, LOW_PERCENTILE, axis=(1, 2), keepdims=True)
    high = np.percentile(channels, HIGH_PERCENTILE, axis=(1, 2), keepdims=True)
    return ((channels - low) / (high - low + 1e-6)).astype(np.float32)[None]


def model_input(rgb: NDArray[np.uint8], microns_per_pixel: float) -> NDArray[np.float32]:
    factor = microns_per_pixel / MODEL_MICRONS_PER_PIXEL
    if factor == 1:
        return normalise(rgb)
    height, width = rgb.shape[:2]
    size = (round(width * factor), round(height * factor))
    resized = Image.fromarray(np.ascontiguousarray(rgb[..., :3])).resize(
        size, Image.Resampling.BILINEAR
    )
    return normalise(np.asarray(resized))


def full_size(labels: NDArray[np.int32], shape: tuple[int, int]) -> NDArray[np.int32]:
    if labels.shape == shape:
        return labels
    resized = Image.fromarray(labels).resize((shape[1], shape[0]), Image.Resampling.NEAREST)
    return np.asarray(resized, dtype=np.int32)


def rings_of(labels: NDArray[np.int32]) -> list[list[float]]:
    rings: list[list[float]] = []
    for label in np.unique(labels):
        if label == 0:
            continue
        ring = ring_of(labels == label)
        if ring is not None and len(ring) >= 6:
            rings.append(ring)
    return rings


def torch_segmenter(folder: Path, threads: int = 0) -> Segmenter:
    import torch

    if threads:
        torch.set_num_threads(threads)
    model = torch.jit.load(str(folder / "instanseg.pt"), map_location="cpu").eval()

    def segment(pixels: NDArray[np.float32]) -> NDArray[np.int32]:
        with torch.no_grad():
            labels = model(torch.from_numpy(pixels))
        return cast("NDArray[np.int32]", labels.numpy()[0, 0].astype(np.int32))

    return segment


def export_network(folder: Path, target: Path) -> None:
    import torch

    model = torch.jit.load(str(folder / "instanseg.pt"), map_location="cpu").eval()
    torch.onnx.export(
        model.fcn,
        (torch.rand(1, 3, 256, 256),),
        str(target),
        input_names=["pixels"],
        output_names=["maps"],
        dynamic_axes={"pixels": {2: "height", 3: "width"}, "maps": {2: "height", 3: "width"}},
        opset_version=17,
        dynamo=False,
    )


def run(segment: Segmenter, images: Iterable[Sample], microns_per_pixel: float) -> InstanSegRun:
    scores: list[ImageScore] = []
    sides: list[int] = []
    times: list[float] = []
    for sample in images:
        pixels = model_input(sample.rgb, microns_per_pixel)
        started = time.perf_counter()
        small = segment(pixels)
        times.append((time.perf_counter() - started) * 1000)
        sides.append(int(pixels.shape[-1]))
        labels = full_size(small, (sample.rgb.shape[0], sample.rgb.shape[1]))
        scores.append(score_image(sample.labels, rings_of(labels), sample.ignore, sample.group))
    return InstanSegRun(summarise(scores, by_group=False), len(scores), sides, times)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Score the InstanSeg brightfield nuclei model on a held-out set"
    )
    parser.add_argument("--dataset", default="tnbc", choices=sorted(DATASET_MICRONS_PER_PIXEL))
    parser.add_argument("--images", type=int, default=None)
    parser.add_argument("--threads", type=int, default=0)
    parser.add_argument("--microns-per-pixel", type=float, default=None)
    parser.add_argument("--model", type=Path, default=model_dir())
    parser.add_argument("--out", type=Path, default=cache_dir() / "instanseg")
    parser.add_argument("--export", action="store_true")
    arguments = parser.parse_args()
    if arguments.export:
        export_network(arguments.model, arguments.model / "instanseg-fcn.onnx")
        return 0
    images = itertools.islice(samples(arguments.dataset), arguments.images)
    result = run(
        torch_segmenter(arguments.model, arguments.threads),
        images,
        arguments.microns_per_pixel or DATASET_MICRONS_PER_PIXEL[arguments.dataset],
    )
    report = {
        "dataset": arguments.dataset,
        "weights": f"{RELEASE}/{WEIGHTS}",
        "machine": platform.platform(),
        "median_segment_ms": float(np.median(result.segment_ms)),
        **asdict(result),
    }
    arguments.out.mkdir(parents=True, exist_ok=True)
    name = f"{arguments.dataset}-{result.input_side[0]}.json"
    (arguments.out / name).write_text(json.dumps(report, indent=2))
    hidden = ("segment_ms", "input_side")
    summary = {key: value for key, value in report.items() if key not in hidden}
    json.dump(summary, sys.stdout, indent=2, default=str)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
