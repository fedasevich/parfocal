import argparse
import itertools
import json
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import IO, Literal, Protocol, cast

import numpy as np
from numpy.typing import NDArray

from parfocal_common.repository import repository_root
from parfocal_ml.datasets import Sample, cache_dir, samples
from parfocal_ml.sam_contract import GRAPHS, IMAGE_SIZE, MASK_INPUT_SIZE, onnx_dir, pixel_values
from parfocal_ml.scoring import ImageScore, Summary, score_image, summarise

BASELINE_PQ = 0.7629
TOLERANCE = 0.01
MICRONS_PER_PIXEL = 0.25
REPOSITORY = repository_root(__file__)
WEB = REPOSITORY / "apps" / "web"
RINGS_SCRIPT = WEB / "region-bench" / "prompt-rings.ts"

Quality = Literal["fast", "best"]


@dataclass(frozen=True)
class PromptRun:
    summary: Summary
    images: int
    decodes: list[int]
    encode_ms: list[float]
    decode_ms: list[float]
    pass_ms: list[float]


class PromptModel(Protocol):
    encode_ms: list[float]
    decode_ms: list[float]

    def encode(self, rgb: NDArray[np.uint8]) -> None: ...

    def best_mask(self, x: float, y: float) -> tuple[NDArray[np.float32], float]: ...


class OnnxPrompt:
    def __init__(
        self, encoder: str, decoder: str, folder: Path | None = None, threads: int = 0
    ) -> None:
        import onnxruntime as ort

        root = folder or onnx_dir()
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        providers = ["CPUExecutionProvider"]
        self.encoder: ort.InferenceSession = ort.InferenceSession(
            str(root / encoder), options, providers=providers
        )
        self.decoder: ort.InferenceSession = ort.InferenceSession(
            str(root / decoder), options, providers=providers
        )
        self.embeddings: NDArray[np.float32] | None = None
        self.encode_ms: list[float] = []
        self.decode_ms: list[float] = []

    def encode(self, rgb: NDArray[np.uint8]) -> None:
        started = time.perf_counter()
        name = self.encoder.get_inputs()[0].name
        self.embeddings = cast(
            "NDArray[np.float32]", self.encoder.run(None, {name: pixel_values(rgb)})[0]
        )
        self.encode_ms.append((time.perf_counter() - started) * 1000)

    def best_mask(self, x: float, y: float) -> tuple[NDArray[np.float32], float]:
        if self.embeddings is None:
            raise RuntimeError("encode an image before prompting")
        started = time.perf_counter()
        feeds = {
            "image_embeddings": self.embeddings,
            "point_coords": np.array([[[x, y], [0.0, 0.0]]], dtype=np.float32),
            "point_labels": np.array([[1.0, -1.0]], dtype=np.float32),
            "mask_input": np.zeros((1, 1, MASK_INPUT_SIZE, MASK_INPUT_SIZE), dtype=np.float32),
            "has_mask_input": np.zeros(1, dtype=np.float32),
            "orig_im_size": np.array([IMAGE_SIZE, IMAGE_SIZE], dtype=np.float32),
        }
        names = [output.name for output in self.decoder.get_outputs()]
        values = dict(zip(names, self.decoder.run(None, feeds), strict=True))
        scores = cast("NDArray[np.float32]", values["iou_predictions"])[0]
        best = int(np.argmax(scores))
        mask = cast("NDArray[np.float32]", values["masks"])[0, best]
        self.decode_ms.append((time.perf_counter() - started) * 1000)
        return np.ascontiguousarray(mask, dtype="<f4"), float(scores[best])


def send(stream: IO[str], message: dict[str, object]) -> None:
    stream.write(json.dumps(message) + "\n")
    stream.flush()


def receive(stream: IO[str]) -> dict[str, object]:
    line = stream.readline()
    if not line:
        raise RuntimeError("the TypeScript prompt pass stopped before answering")
    return cast("dict[str, object]", json.loads(line))


def outline_image(
    model: PromptModel,
    child: subprocess.Popen[str],
    sample: Sample,
    folder: Path,
    quality: Quality,
) -> tuple[list[list[float]], int, float]:
    stdin = cast("IO[str]", child.stdin)
    stdout = cast("IO[str]", child.stdout)
    model.encode(sample.rgb)
    rgb_file = folder / "image.rgb"
    np.ascontiguousarray(sample.rgb[..., :3], dtype=np.uint8).tofile(rgb_file)
    height, width = sample.rgb.shape[:2]
    send(
        stdin,
        {
            "type": "image",
            "name": sample.name,
            "rgb": str(rgb_file),
            "width": width,
            "height": height,
            "micronsPerPixel": MICRONS_PER_PIXEL,
            "quality": quality,
        },
    )
    mask_file = folder / "mask.f32"
    while True:
        message = receive(stdout)
        if message["type"] == "rings":
            rings = cast("list[list[float]]", message["rings"])
            return rings, int(cast("int", message["decodes"])), float(cast("float", message["ms"]))
        x = float(cast("float", message["x"]))
        y = float(cast("float", message["y"]))
        mask, score = model.best_mask(x, y)
        mask.tofile(mask_file)
        send(stdin, {"type": "mask", "file": str(mask_file), "side": mask.shape[0], "score": score})


def run(model: PromptModel, images: Iterable[Sample], quality: Quality = "fast") -> PromptRun:
    node = shutil.which("node")
    if node is None:
        raise FileNotFoundError("node is needed to run the TypeScript prompt pass")
    scores: list[ImageScore] = []
    decodes: list[int] = []
    pass_ms: list[float] = []
    with tempfile.TemporaryDirectory(prefix="parfocal-prompt-") as scratch:
        folder = Path(scratch)
        child = subprocess.Popen(
            [node, str(RINGS_SCRIPT)],
            cwd=WEB,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        try:
            for sample in images:
                rings, count, ms = outline_image(model, child, sample, folder, quality)
                scores.append(score_image(sample.labels, rings, sample.ignore, sample.group))
                decodes.append(count)
                pass_ms.append(ms)
            stdin = cast("IO[str]", child.stdin)
            send(stdin, {"type": "done"})
            stdin.close()
            if child.wait(timeout=30) != 0:
                raise RuntimeError("the TypeScript prompt pass failed")
        finally:
            if child.poll() is None:
                child.kill()
    return PromptRun(
        summary=summarise(scores),
        images=len(scores),
        decodes=decodes,
        encode_ms=model.encode_ms,
        decode_ms=model.decode_ms,
        pass_ms=pass_ms,
    )


def median(values: list[float] | list[int]) -> float:
    return round(float(np.median(values)), 1) if values else float("nan")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Score the auto region tool's prompt-pass fallback on TNBC"
    )
    parser.add_argument("--images", type=int, default=None)
    parser.add_argument("--quality", choices=["fast", "best"], default="fast")
    parser.add_argument("--encoder", default=GRAPHS.encoder_uint8)
    parser.add_argument("--decoder", default=GRAPHS.decoder)
    parser.add_argument("--threads", type=int, default=0)
    parser.add_argument("--out", type=Path, default=cache_dir() / "prompt-region")
    arguments = parser.parse_args()
    import onnxruntime as ort

    arguments.out.mkdir(parents=True, exist_ok=True)
    quality = cast("Quality", arguments.quality)
    model = OnnxPrompt(arguments.encoder, arguments.decoder, threads=arguments.threads)
    started = time.perf_counter()
    images = itertools.islice(samples("tnbc"), arguments.images)
    result = run(model, images, quality)
    summary = {key: value for key, value in asdict(result.summary).items() if key != "groups"}
    report = {
        "dataset": "tnbc",
        "images": result.images,
        "quality": quality,
        "encoder": arguments.encoder,
        "decoder": arguments.decoder,
        "summary": summary,
        "baseline_pq": BASELINE_PQ,
        "tolerance": TOLERANCE,
        "within_tolerance": result.summary.pq >= BASELINE_PQ - TOLERANCE,
        "seconds": round(time.perf_counter() - started, 1),
        "decodes_total": sum(result.decodes),
        "decodes_median": median(result.decodes),
        "encode_ms_median": median(result.encode_ms),
        "decode_ms_median": median(result.decode_ms),
        "pass_ms_median": median(result.pass_ms),
        "versions": {
            "onnxruntime": ort.__version__,
            "numpy": np.__version__,
            "python": platform.python_version(),
        },
        "machine": f"{platform.machine()} {platform.platform()}",
    }
    stem = f"{quality}-{result.images}"
    (arguments.out / f"{stem}.json").write_text(json.dumps(report, indent=2))
    json.dump(report, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
