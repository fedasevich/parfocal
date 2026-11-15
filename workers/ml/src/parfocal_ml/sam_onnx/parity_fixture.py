import argparse
import hashlib
import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from parfocal_ml.datasets import cache_dir
from parfocal_ml.sam_contract import (
    AIS,
    AIS_QUANTISED_MIN_IOU,
    CHUNK,
    GRAPHS,
    QUANTISED_MIN_IOU,
    SAM,
    onnx_dir,
    scaled_point,
)

FIXTURE_FOLDER = "sam-parity"
BROWSER_GRAPHS = (
    GRAPHS.encoder_q4,
    GRAPHS.encoder_uint8,
    GRAPHS.decoder,
    GRAPHS.ais_decoder,
    GRAPHS.ais_decoder_int8_weights,
    GRAPHS.ais_decoder_uint8,
)


@dataclass(frozen=True)
class ParityPatch:
    name: str
    height: int
    width: int
    pixels: NDArray[np.float32]
    clicks: Sequence[tuple[float, float]]
    embeddings: NDArray[np.float32]
    masks: Sequence[NDArray[np.float32]]
    maps: NDArray[np.float32]


def fixture_dir() -> Path:
    return cache_dir() / FIXTURE_FOLDER


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(CHUNK):
            digest.update(block)
    return digest.hexdigest()


def little_endian(values: NDArray[np.float32]) -> bytes:
    return np.ascontiguousarray(values, dtype="<f4").tobytes()


def write(
    out: Path, patches: Sequence[ParityPatch], graphs: dict[str, str], versions: dict[str, str]
) -> dict[str, object]:
    out.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, object]] = []
    for number, patch in enumerate(patches):
        stem = f"p{number}"
        (out / f"{stem}.pixels").write_bytes(little_endian(patch.pixels))
        (out / f"{stem}.embeddings").write_bytes(little_endian(patch.embeddings))
        (out / f"{stem}.maps").write_bytes(little_endian(patch.maps))
        masks = np.stack([logits > 0 for logits in patch.masks]).astype(np.uint8)
        (out / f"{stem}.masks").write_bytes(masks.tobytes())
        manifest.append(
            {
                "name": patch.name,
                "height": patch.height,
                "width": patch.width,
                "pixels": f"{stem}.pixels",
                "embeddings": f"{stem}.embeddings",
                "maps": f"{stem}.maps",
                "mapsDims": list(patch.maps.shape),
                "masks": f"{stem}.masks",
                "clicks": [
                    list(scaled_point(x, y, patch.height, patch.width)) for x, y in patch.clicks
                ],
            }
        )
    document: dict[str, object] = {
        "thresholds": {
            "clickMeanIou": QUANTISED_MIN_IOU,
            "aisMeanForegroundIou": AIS_QUANTISED_MIN_IOU,
        },
        "checkpoints": {SAM.file: SAM.sha256, AIS.file: AIS.sha256},
        "graphs": graphs,
        "versions": versions,
        "patches": manifest,
    }
    (out / "manifest.json").write_text(json.dumps(document, indent=2))
    return document


def build(patch_count: int, clicks_per_patch: int, out: Path) -> dict[str, object]:
    import platform

    import torch

    from parfocal_ml.sam_onnx.verify import tnbc_patches, torch_references

    samples = tnbc_patches(patch_count)
    references = torch_references(samples, clicks_per_patch, [])
    patches: list[ParityPatch] = []
    for sample, reference in zip(samples, references, strict=True):
        assert reference.maps is not None
        patches.append(
            ParityPatch(
                name=sample.name,
                height=reference.height,
                width=reference.width,
                pixels=reference.pixels,
                clicks=reference.clicks,
                embeddings=reference.embeddings,
                masks=reference.logits,
                maps=reference.maps,
            )
        )
    folder = onnx_dir()
    graphs = {name: sha256(folder / name) for name in BROWSER_GRAPHS if (folder / name).exists()}
    versions = {"torch": torch.__version__, "python": platform.python_version()}
    return write(out, patches, graphs, versions)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Write PyTorch PathoSAM outputs on fixed TNBC patches for browser parity"
    )
    parser.add_argument("--patches", type=int, default=6)
    parser.add_argument("--clicks", type=int, default=8)
    parser.add_argument("--out", type=Path, default=fixture_dir())
    args = parser.parse_args()
    document = build(args.patches, args.clicks, args.out)
    patches = document["patches"]
    assert isinstance(patches, list)
    clicks = sum(len(patch["clicks"]) for patch in patches)
    print(f"wrote {len(patches)} patches and {clicks} clicks to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
