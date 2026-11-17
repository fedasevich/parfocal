import argparse
import gc
import itertools
import json
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from numpy.typing import NDArray
from torch import Tensor, nn
from torch.nn import functional

from parfocal_common.model_artifacts import sha256_of_file
from parfocal_ml.datasets import PANNUKE_CLASSES, Sample, samples
from parfocal_ml.outline_typer_worker import INPUT_NAME, OnnxTyper
from parfocal_ml.sam_contract import models_dir, onnx_dir
from parfocal_ml.typer import CLASS_CHANNELS, Model, Outline, average_inside, pannuke_to_viewer

ENCODER = "convnextv2_tiny.fcmae_ft_in22k_in1k"
RELEASE = "pannuke_convnextv2_tiny_2"
INSTANCE_CHANNELS = 5
DECODER_WIDTHS = (256, 128, 64, 32)
STRIDE = 32
OPSET = 17
OUTPUT_NAME = "classes"
EXPORT_SHAPE = (1, 250, 270, 3)
PARITY_SIDES = ((256, 256), (300, 417), (1060, 1060))
PARITY_TOLERANCE = 1e-4
CHECKED_IMAGES = 60


def weights_dir() -> Path:
    return models_dir() / "hovernext" / RELEASE


def checkpoint_path() -> Path:
    return weights_dir() / "train" / "best_model"


def export_path() -> Path:
    return onnx_dir() / "hovernext-pannuke.typer.onnx"


def conv_relu(entering: int, leaving: int) -> nn.Sequential:
    return nn.Sequential(nn.Conv2d(entering, leaving, 3, padding=1), nn.ReLU())


class UpBlock(nn.Module):
    def __init__(self, entering: int, skip: int, leaving: int) -> None:
        super().__init__()
        self.conv1 = conv_relu(entering + skip, leaving)
        self.conv2 = conv_relu(leaving, leaving)

    def forward(self, x: Tensor, skip: Tensor | None) -> Tensor:
        x = functional.interpolate(x, scale_factor=2.0, mode="nearest")
        if skip is not None:
            x = torch.cat([x, skip], 1)
        return self.conv2(self.conv1(x))


class Decoder(nn.Module):
    def __init__(self, encoder_channels: Sequence[int]) -> None:
        super().__init__()
        deep = list(reversed(encoder_channels))
        entering = [deep[0], *DECODER_WIDTHS[:-1]]
        skips = [*deep[1:], 0]
        blocks = [
            UpBlock(width_in, skip, width_out)
            for width_in, skip, width_out in zip(entering, skips, DECODER_WIDTHS, strict=True)
        ]
        blocks.append(UpBlock(DECODER_WIDTHS[-1], 0, DECODER_WIDTHS[-1] // 2))
        self.blocks = nn.ModuleList(blocks)

    def forward(self, features: Sequence[Tensor]) -> Tensor:
        deep = list(reversed(features))
        x = deep[0]
        for index, block in enumerate(self.blocks):
            x = block(x, deep[index + 1] if index + 1 < len(deep) else None)
        return x


class Backbone(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        import timm

        self.model = timm.create_model(
            ENCODER, pretrained=False, features_only=True, out_indices=(0, 1, 2, 3)
        )
        info: Any = self.model.feature_info
        self.channels: list[int] = [int(channel) for channel in info.channels()]

    def forward(self, x: Tensor) -> list[Tensor]:
        return list(self.model(x))


class HoverNext(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.encoder = Backbone()
        width = DECODER_WIDTHS[-1] // 2
        self.decoders = nn.ModuleList([Decoder(self.encoder.channels) for _ in range(2)])
        self.heads = nn.ModuleList(
            [
                nn.Sequential(nn.Conv2d(width, INSTANCE_CHANNELS, 1)),
                nn.Sequential(nn.Conv2d(width, CLASS_CHANNELS, 1)),
            ]
        )


class PixelTyper(nn.Module):
    def __init__(self, network: HoverNext) -> None:
        super().__init__()
        self.encoder = network.encoder
        self.decoder = network.decoders[1]
        self.head = network.heads[1]

    def forward(self, pixels: Tensor) -> Tensor:
        height, width = pixels.shape[1], pixels.shape[2]
        x = pixels.permute(0, 3, 1, 2).float() / 255.0
        below = (STRIDE - height % STRIDE) % STRIDE
        right = (STRIDE - width % STRIDE) % STRIDE
        x = functional.pad(x, (0, right, 0, below), mode="reflect")
        logits = self.head(self.decoder(self.encoder(x)))
        return logits[:, :, :height, :width].softmax(1)


def loaded_typer(checkpoint: Path) -> PixelTyper:
    network = HoverNext()
    stored = torch.load(checkpoint, map_location="cpu", weights_only=True)
    state = {
        key.removeprefix("module."): value for key, value in stored["model_state_dict"].items()
    }
    network.load_state_dict(state, strict=True)
    return PixelTyper(network).eval()


def export_typer(typer: PixelTyper, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    example = torch.zeros(EXPORT_SHAPE, dtype=torch.uint8)
    torch.onnx.export(
        typer,
        (example,),
        str(target),
        input_names=[INPUT_NAME],
        output_names=[OUTPUT_NAME],
        dynamic_axes={
            INPUT_NAME: {1: "height", 2: "width"},
            OUTPUT_NAME: {2: "height", 3: "width"},
        },
        opset_version=OPSET,
        dynamo=False,
    )


def tissue_crop(pixels: Sequence[NDArray[np.uint8]], height: int, width: int) -> NDArray[np.uint8]:
    side = pixels[0].shape[0]
    rows = -(-height // side)
    columns = -(-width // side)
    tiles = itertools.cycle(pixels)
    grid = np.concatenate(
        [np.concatenate([next(tiles) for _ in range(columns)], 1) for _ in range(rows)], 0
    )
    return np.ascontiguousarray(grid[:height, :width])


def torch_classes(typer: PixelTyper, rgb: NDArray[np.uint8]) -> NDArray[np.float32]:
    with torch.no_grad():
        return typer(torch.from_numpy(rgb[None])).numpy()[0]


@dataclass(frozen=True)
class Parity:
    height: int
    width: int
    max_abs_difference: float
    argmax_agreement: float


def parity(typer: PixelTyper, onnx: Model, rgb: NDArray[np.uint8]) -> Parity:
    expected = torch_classes(typer, rgb)
    got = onnx(rgb)
    if got.shape != expected.shape:
        raise ValueError(f"ONNX gives {got.shape}, torch gives {expected.shape}")
    agreement = float((got.argmax(0) == expected.argmax(0)).mean())
    return Parity(rgb.shape[0], rgb.shape[1], float(np.abs(got - expected).max()), agreement)


@dataclass(frozen=True)
class Typing:
    images: int
    nuclei: int
    pannuke_accuracy: float
    viewer_accuracy: float


def nucleus_outlines(sample: Sample) -> Iterable[tuple[Outline, str]]:
    for number, kind in (sample.classes or {}).items():
        mask = sample.labels == number
        rows, columns = np.nonzero(mask)
        top, left = int(rows.min()), int(columns.min())
        box = mask[top : int(rows.max()) + 1, left : int(columns.max()) + 1]
        yield Outline(box, left, top), kind


def typing_check(model: Model, chosen: Iterable[Sample]) -> Typing:
    viewer_of = pannuke_to_viewer()
    images = nuclei = pannuke_right = viewer_right = 0
    for sample in chosen:
        images += 1
        class_map = model(sample.rgb)
        for outline, kind in nucleus_outlines(sample):
            averaged = average_inside(class_map, outline)
            if averaged is None:
                continue
            mass, _ = averaged
            truth = PANNUKE_CLASSES.index(kind)
            called = int(np.argmax(mass))
            viewer = np.zeros(max(viewer_of) + 1)
            np.add.at(viewer, list(viewer_of), mass)
            nuclei += 1
            pannuke_right += called == truth
            viewer_right += int(np.argmax(viewer)) == viewer_of[truth]
    return Typing(images, nuclei, pannuke_right / max(nuclei, 1), viewer_right / max(nuclei, 1))


def run(target: Path, images: int) -> dict[str, object]:
    checkpoint = checkpoint_path()
    typer = loaded_typer(checkpoint)
    export_typer(typer, target)
    onnx = OnnxTyper(target)
    fixtures = [sample.rgb for sample in itertools.islice(samples("pannuke-fold3"), 4)]
    checks = [parity(typer, onnx, tissue_crop(fixtures, *sides)) for sides in PARITY_SIDES]
    del typer
    gc.collect()
    chosen = itertools.islice(samples("pannuke-fold3"), 0, None, 5)
    typing = typing_check(onnx, itertools.islice(chosen, images))
    return {
        "checkpoint_sha256": sha256_of_file(checkpoint),
        "onnx_sha256": sha256_of_file(target),
        "onnx_bytes": target.stat().st_size,
        "parity": [asdict(check) for check in checks],
        "typing_on_pannuke_fold3": asdict(typing),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=export_path())
    parser.add_argument("--images", type=int, default=CHECKED_IMAGES)
    arguments = parser.parse_args()
    torch.set_num_threads(4)
    print(json.dumps(run(arguments.out, arguments.images), indent=2))


if __name__ == "__main__":
    main()
