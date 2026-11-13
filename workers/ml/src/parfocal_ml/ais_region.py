import argparse
import itertools
import json
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import cast

import numpy as np
from numpy.typing import NDArray

from parfocal_common.repository import repository_root
from parfocal_ml.datasets import Sample, cache_dir, samples
from parfocal_ml.sam_contract import GRAPHS, onnx_dir, pixel_values
from parfocal_ml.scoring import ImageScore, Summary, score_image, summarise

BASELINE_PQ = 0.8235
TOLERANCE = 0.01
REPOSITORY = repository_root(__file__)
RINGS_SCRIPT = REPOSITORY / "apps" / "web" / "region-bench" / "ais-rings.ts"


@dataclass(frozen=True)
class Maps:
    name: str
    maps: NDArray[np.float32]


@dataclass(frozen=True)
class RegionRun:
    summary: Summary
    images: int
    encode_ms: list[float]
    ais_ms: list[float]
    outline_ms: list[float]


class OnnxAis:
    def __init__(
        self, encoder: str, ais_decoder: str, folder: Path | None = None, threads: int = 0
    ) -> None:
        import onnxruntime as ort

        root = folder or onnx_dir()
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        providers = ["CPUExecutionProvider"]
        self.encoder: ort.InferenceSession = ort.InferenceSession(
            str(root / encoder), options, providers=providers
        )
        self.ais: ort.InferenceSession = ort.InferenceSession(
            str(root / ais_decoder), options, providers=providers
        )
        self.encode_ms: list[float] = []
        self.ais_ms: list[float] = []

    def maps(self, rgb: NDArray[np.uint8]) -> NDArray[np.float32]:
        if rgb.shape[0] != rgb.shape[1]:
            raise ValueError("the AIS decoder graph is traced square")
        started = time.perf_counter()
        name = self.encoder.get_inputs()[0].name
        embeddings = self.encoder.run(None, {name: pixel_values(rgb)})[0]
        self.encode_ms.append((time.perf_counter() - started) * 1000)
        started = time.perf_counter()
        maps = cast("NDArray[np.float32]", self.ais.run(None, {"image_embeddings": embeddings})[0])
        self.ais_ms.append((time.perf_counter() - started) * 1000)
        return np.ascontiguousarray(maps[0], dtype=np.float32)


def write_maps(folder: Path, entries: Iterable[Maps]) -> None:
    manifest: list[dict[str, object]] = []
    for index, entry in enumerate(entries):
        _, height, width = entry.maps.shape
        file = f"m{index}.f32"
        entry.maps.astype("<f4").tofile(folder / file)
        manifest.append({"name": entry.name, "file": file, "width": width, "height": height})
    (folder / "maps.json").write_text(json.dumps(manifest))


def typescript_rings(folder: Path) -> dict[str, tuple[list[list[float]], float]]:
    node = shutil.which("node")
    if node is None:
        raise FileNotFoundError("node is needed to run the TypeScript AIS post-processing")
    out = folder / "rings.json"
    subprocess.run([node, str(RINGS_SCRIPT), str(folder), str(out)], check=True)
    entries = cast("list[dict[str, object]]", json.loads(out.read_text()))
    return {
        str(entry["name"]): (
            cast("list[list[float]]", entry["rings"]),
            float(cast("float", entry["ms"])),
        )
        for entry in entries
    }


def run(
    model: OnnxAis | None, images: Iterable[Sample], maps_folder: Path | None = None
) -> RegionRun:
    kept = list(images)
    with tempfile.TemporaryDirectory(prefix="parfocal-ais-") as scratch:
        folder = maps_folder or Path(scratch)
        folder.mkdir(parents=True, exist_ok=True)
        if model is not None:
            write_maps(folder, (Maps(sample.name, model.maps(sample.rgb)) for sample in kept))
        rings = typescript_rings(folder)
    scores: list[ImageScore] = []
    outline_ms: list[float] = []
    for sample in kept:
        image_rings, ms = rings[sample.name]
        outline_ms.append(ms)
        scores.append(score_image(sample.labels, image_rings, sample.ignore, sample.group))
    return RegionRun(
        summary=summarise(scores),
        images=len(kept),
        encode_ms=model.encode_ms if model is not None else [],
        ais_ms=model.ais_ms if model is not None else [],
        outline_ms=outline_ms,
    )


def median(values: Sequence[float]) -> float:
    return round(float(np.median(values)), 1) if values else float("nan")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Score the auto region tool's AIS post-processing on TNBC"
    )
    parser.add_argument("--images", type=int, default=None)
    parser.add_argument("--encoder", default=GRAPHS.encoder_uint8)
    parser.add_argument("--ais-decoder", default=GRAPHS.ais_decoder_int8_weights)
    parser.add_argument("--threads", type=int, default=0)
    parser.add_argument("--out", type=Path, default=cache_dir() / "ais-region")
    parser.add_argument("--rescore", action="store_true")
    arguments = parser.parse_args()
    import onnxruntime as ort

    arguments.out.mkdir(parents=True, exist_ok=True)
    stem = f"{Path(arguments.encoder).stem}+{Path(arguments.ais_decoder).stem}"
    model = (
        None
        if arguments.rescore
        else OnnxAis(arguments.encoder, arguments.ais_decoder, threads=arguments.threads)
    )
    started = time.perf_counter()
    images = itertools.islice(samples("tnbc"), arguments.images)
    result = run(model, images, arguments.out / stem)
    summary = {key: value for key, value in asdict(result.summary).items() if key != "groups"}
    report = {
        "dataset": "tnbc",
        "images": result.images,
        "encoder": arguments.encoder,
        "ais_decoder": arguments.ais_decoder,
        "summary": summary,
        "baseline_pq": BASELINE_PQ,
        "tolerance": TOLERANCE,
        "within_tolerance": result.summary.pq >= BASELINE_PQ - TOLERANCE,
        "seconds": round(time.perf_counter() - started, 1),
        "encode_ms_median": median(result.encode_ms),
        "ais_ms_median": median(result.ais_ms),
        "outline_ms_median": median(result.outline_ms),
        "outline_ms_max": round(max(result.outline_ms), 1) if result.outline_ms else None,
        "versions": {
            "onnxruntime": ort.__version__,
            "numpy": np.__version__,
            "python": platform.python_version(),
        },
        "machine": f"{platform.machine()} {platform.platform()}",
    }
    (arguments.out / f"{stem}.json").write_text(json.dumps(report, indent=2))
    json.dump(report, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
