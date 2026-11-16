import argparse
import json
import os
import platform
import resource
import sys
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from parfocal_ml.datasets import Sample, cache_dir
from parfocal_ml.nuclei import half_pixel_resize, outlines_of, stitched_maps
from parfocal_ml.sam_contract import (
    AIS,
    AIS_VIT_L,
    SAM,
    SAM_VIT_L,
    Checkpoint,
    checkpoint_path,
    pixel_values,
    resized_shape,
)
from parfocal_ml.scoring import ImageScore, Summary, score_image, summarise

type Ring = list[float]
type Detector = Callable[[NDArray[np.uint8]], list[Ring]]

POC_FIXTURES = Path(
    os.environ.get(
        "PARFOCAL_POC_FIXTURES", "/Users/yuriifedas/WebstormProjects/poc/server/fixtures"
    )
)
DATASETS = ("tnbc", "nuinsseg", "cryonuseg")
SUBSET_STEP = {"tnbc": 1, "nuinsseg": 10, "cryonuseg": 1}
STORED = {"hovernet": "hovernet-batch", "pathosam-vit-b-poc": "pathosam-ais-batch"}
SAM_WEIGHTS = {
    "pathosam-vit-b": ("vit_b", SAM, AIS),
    "pathosam-vit-l": ("vit_l", SAM_VIT_L, AIS_VIT_L),
}
MODELS = (*SAM_WEIGHTS, "instanseg", *STORED)
FIXTURE_MICRONS_PER_PIXEL = 0.25


@dataclass(frozen=True)
class LineupRun:
    summary: Summary
    images: int
    mean_pq: float
    mean_f1: float
    infer_ms: list[float]


def fixture_samples(
    dataset: str, folder: Path = POC_FIXTURES, step: int | None = None
) -> list[Sample]:
    root = folder / dataset
    index = json.loads((root / "index.json").read_text())
    kept: list[Sample] = []
    for image in index["images"][:: step or SUBSET_STEP[dataset]]:
        name = image["name"]
        shape = (image["height"], image["width"])
        labels = np.fromfile(root / f"{name}.labels", "<u2").reshape(shape).astype(np.int32)
        rgba = np.fromfile(root / f"{name}.rgba", np.uint8).reshape((*shape, 4))
        ignore_file = root / f"{name}.ignore"
        ignore = (
            np.fromfile(ignore_file, np.uint8).reshape(shape) > 0 if ignore_file.exists() else None
        )
        kept.append(
            Sample(
                name=name,
                rgb=np.ascontiguousarray(rgba[..., :3]),
                labels=labels,
                ignore=ignore,
                group=name.split("__", 1)[0] if "__" in name else None,
            )
        )
    return kept


def stored_rings(dataset: str, method: str, folder: Path = POC_FIXTURES) -> dict[str, list[Ring]]:
    path = folder / dataset / "results" / f"{STORED[method]}.jsonl"
    found: dict[str, list[Ring]] = {}
    for line in path.read_text().splitlines():
        if line.strip():
            record = json.loads(line)
            found[record["image"]] = record["rings"]
    return found


def image_mean(scores: Sequence[ImageScore], metric: str) -> float:
    values = [
        getattr(summarise([score], by_group=False), metric)
        for score in scores
        if score.nuclei or score.predicted
    ]
    return float(np.mean(values)) if values else float("nan")


def run(detect: Detector, images: Iterable[Sample]) -> LineupRun:
    scores: list[ImageScore] = []
    times: list[float] = []
    for sample in images:
        started = time.perf_counter()
        rings = detect(sample.rgb)
        times.append((time.perf_counter() - started) * 1000)
        scores.append(score_image(sample.labels, rings, sample.ignore, sample.group))
    return LineupRun(
        summary=summarise(scores, by_group=False),
        images=len(scores),
        mean_pq=image_mean(scores, "pq"),
        mean_f1=image_mean(scores, "f1"),
        infer_ms=times,
    )


def load_state(path: Path) -> dict[str, Any]:
    import torch

    try:
        state = torch.load(path, map_location="cpu", weights_only=True)
    except Exception:
        state = torch.load(path, map_location="cpu", weights_only=False)
    if isinstance(state, dict) and "model_state" in state:
        state = state["model_state"]
    return state


class TorchPathoSam:
    def __init__(
        self, kind: str, encoder: Checkpoint, decoder: Checkpoint, folder: Path | None = None
    ) -> None:
        import torch
        from segment_anything import sam_model_registry

        from parfocal_ml.sam_onnx.instance_decoder import InstanceDecoder

        sam = sam_model_registry[kind]()
        sam.load_state_dict(load_state(checkpoint_path(encoder, folder)), strict=True)
        self.encoder: Any = sam.image_encoder.eval()
        self.decoder: Any = InstanceDecoder()
        self.decoder.load_state_dict(load_state(checkpoint_path(decoder, folder)), strict=True)
        self.decoder.eval()
        self.torch: Any = torch

    def maps(self, rgb: NDArray[np.uint8]) -> NDArray[np.float32]:
        height, width = rgb.shape[:2]
        resized_h, resized_w = resized_shape(height, width)
        with self.torch.inference_mode():
            embedding = self.encoder(self.torch.from_numpy(pixel_values(np.ascontiguousarray(rgb))))
            raw = self.decoder(embedding)[0].numpy().astype(np.float32)
        return half_pixel_resize(raw[:, :resized_h, :resized_w], height, width)


def pathosam_detector(model: TorchPathoSam) -> Detector:
    def detect(rgb: NDArray[np.uint8]) -> list[Ring]:
        return [outline.ring.ravel().tolist() for outline in outlines_of(stitched_maps(rgb, model))]

    return detect


def instanseg_detector(microns_per_pixel: float = FIXTURE_MICRONS_PER_PIXEL) -> Detector:
    from parfocal_ml.instanseg import full_size, model_dir, model_input, rings_of, torch_segmenter

    segment = torch_segmenter(model_dir())

    def detect(rgb: NDArray[np.uint8]) -> list[Ring]:
        small = segment(model_input(rgb, microns_per_pixel))
        return rings_of(full_size(small, (rgb.shape[0], rgb.shape[1])))

    return detect


def stored_detector(dataset: str, method: str, images: Sequence[Sample]) -> Detector:
    rings = stored_rings(dataset, method)
    order = iter([sample.name for sample in images])

    def detect(_: NDArray[np.uint8]) -> list[Ring]:
        return rings[next(order)]

    return detect


def detector_for(model: str, dataset: str, images: Sequence[Sample]) -> Detector:
    if model in SAM_WEIGHTS:
        return pathosam_detector(TorchPathoSam(*SAM_WEIGHTS[model]))
    if model == "instanseg":
        return instanseg_detector()
    return stored_detector(dataset, model, images)


def peak_rss_bytes() -> int:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(peak if sys.platform == "darwin" else peak * 1024)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Score nucleus detectors on the held-out sets with one scorer"
    )
    parser.add_argument("--model", choices=MODELS, required=True)
    parser.add_argument("--dataset", choices=DATASETS, required=True)
    parser.add_argument("--images", type=int, default=None)
    parser.add_argument("--threads", type=int, default=0)
    parser.add_argument("--out", type=Path, default=cache_dir() / "nucleus-lineup")
    arguments = parser.parse_args()
    if arguments.threads:
        import torch

        torch.set_num_threads(arguments.threads)
    images = fixture_samples(arguments.dataset)[: arguments.images]
    started = time.perf_counter()
    detect = detector_for(arguments.model, arguments.dataset, images)
    result = run(detect, images)
    summary = {key: value for key, value in asdict(result.summary).items() if key != "groups"}
    report = {
        "model": arguments.model,
        "dataset": arguments.dataset,
        "images": result.images,
        "summary": summary,
        "mean_pq_over_images": result.mean_pq,
        "mean_f1_over_images": result.mean_f1,
        "median_infer_ms": float(np.median(result.infer_ms)) if result.infer_ms else None,
        "seconds": round(time.perf_counter() - started, 1),
        "peak_rss_bytes": peak_rss_bytes(),
        "threads": arguments.threads,
        "machine": f"{platform.machine()} {platform.platform()}",
    }
    arguments.out.mkdir(parents=True, exist_ok=True)
    suffix = f"-{result.images}" if arguments.images else ""
    (arguments.out / f"{arguments.model}-{arguments.dataset}{suffix}.json").write_text(
        json.dumps(report, indent=2)
    )
    json.dump(report, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
