import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from PIL import Image

IMAGE_SIZE = 1024
EMBED_DIM = 256
EMBED_SIZE = 64
MASK_INPUT_SIZE = 4 * EMBED_SIZE
AIS_OUTPUT_SIZE = 512
OPSET = 17
PIXEL_MEAN = np.array([123.675, 116.28, 103.53], dtype=np.float32)
PIXEL_STD = np.array([58.395, 57.12, 57.375], dtype=np.float32)
FP32_MIN_IOU = 1.0
FP32_NOISE_LOGIT = 1e-3
AIS_MAX_ABS = 1e-3
QUANTISED_MIN_IOU = 0.96
CHUNK = 1 << 20


@dataclass(frozen=True)
class Checkpoint:
    file: str
    sha256: str
    size: int


SAM = Checkpoint(
    file="vit_b_histopathology.pt",
    sha256="98c79908dd899e5d26ddf3fdca564d2642362146f30d4c867d38825c8b4ad417",
    size=375023106,
)
AIS = Checkpoint(
    file="vit_b_histopathology_decoder.pt",
    sha256="be91d6272ab2f5cdfeeee5c0b7eb6c864f860072739e246408b7212600849f4b",
    size=44143988,
)


@dataclass(frozen=True)
class Graphs:
    encoder: str = "pathosam.encoder.onnx"
    encoder_uint8: str = "pathosam.encoder_uint8.onnx"
    encoder_q4: str = "pathosam.encoder_q4.onnx"
    decoder: str = "pathosam.decoder.onnx"
    batch_decoder: str = "pathosam.decoder_batch.onnx"
    ais_decoder: str = "pathosam.ais_decoder.onnx"


GRAPHS = Graphs()


class MissingCheckpointError(FileNotFoundError):
    pass


class CheckpointMismatchError(ValueError):
    pass


def models_dir() -> Path:
    configured = os.environ.get("PARFOCAL_MODELS_DIR")
    if configured:
        return Path(configured)
    base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "parfocal" / "models"


def onnx_dir() -> Path:
    return models_dir() / "onnx"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def matches(path: Path, checkpoint: Checkpoint) -> bool:
    return path.stat().st_size == checkpoint.size and sha256_of(path) == checkpoint.sha256


def local_folders() -> list[Path]:
    configured = os.environ.get("PARFOCAL_MODELS_LOCAL", "")
    return [Path(folder) for folder in configured.split(":") if folder]


def checkpoint_path(checkpoint: Checkpoint, folder: Path | None = None) -> Path:
    target = (folder or models_dir()) / checkpoint.file
    if not target.exists():
        for local in local_folders():
            candidate = local / checkpoint.file
            if candidate.exists() and matches(candidate, checkpoint):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(candidate.resolve())
                break
    if not target.exists():
        raise MissingCheckpointError(
            f"{checkpoint.file} is not in {target.parent}. Put it there or name a folder "
            "that holds it in PARFOCAL_MODELS_LOCAL."
        )
    verified = target.with_name(target.name + ".sha256")
    if verified.exists() and verified.read_text().strip() == checkpoint.sha256:
        return target
    if not matches(target, checkpoint):
        raise CheckpointMismatchError(f"{target} does not match SHA-256 {checkpoint.sha256}")
    verified.write_text(checkpoint.sha256 + "\n")
    return target


def resized_shape(height: int, width: int, size: int = IMAGE_SIZE) -> tuple[int, int]:
    scale = size / max(height, width)
    return int(height * scale + 0.5), int(width * scale + 0.5)


def pixel_values(rgb: NDArray[np.uint8]) -> NDArray[np.float32]:
    height, width = rgb.shape[:2]
    new_height, new_width = resized_shape(height, width)
    resized = np.asarray(
        Image.fromarray(rgb).resize((new_width, new_height), Image.Resampling.BILINEAR),
        dtype=np.float32,
    )
    normalised = (resized - PIXEL_MEAN) / PIXEL_STD
    padded = np.zeros((IMAGE_SIZE, IMAGE_SIZE, 3), dtype=np.float32)
    padded[:new_height, :new_width] = normalised
    return padded.transpose(2, 0, 1)[None].copy()


def scaled_point(x: float, y: float, height: int, width: int) -> tuple[float, float]:
    new_height, new_width = resized_shape(height, width)
    return x * new_width / width, y * new_height / height


def decoder_feeds(
    embeddings: NDArray[np.float32], click: tuple[float, float], height: int, width: int
) -> dict[str, NDArray[np.float32]]:
    if height != width:
        raise ValueError("the decoder graph is traced square, so orig_im_size must be square")
    x, y = scaled_point(click[0], click[1], height, width)
    return {
        "image_embeddings": embeddings,
        "point_coords": np.array([[[x, y], [0.0, 0.0]]], dtype=np.float32),
        "point_labels": np.array([[1.0, -1.0]], dtype=np.float32),
        "mask_input": np.zeros((1, 1, MASK_INPUT_SIZE, MASK_INPUT_SIZE), dtype=np.float32),
        "has_mask_input": np.zeros(1, dtype=np.float32),
        "orig_im_size": np.array([height, width], dtype=np.float32),
    }


def best_multimask(masks: NDArray[np.float32], scores: NDArray[np.float32]) -> NDArray[np.bool_]:
    best = 1 + int(np.argmax(scores[0, 1:]))
    return masks[0, best] > 0


def iou(a: NDArray[np.bool_], b: NDArray[np.bool_]) -> float:
    union = int(np.logical_or(a, b).sum())
    return float(np.logical_and(a, b).sum() / union) if union else 1.0
