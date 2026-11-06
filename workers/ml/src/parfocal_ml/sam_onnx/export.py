import argparse
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import onnx
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.matmul_nbits_quantizer import (
    DefaultWeightOnlyQuantConfig,
    MatMulNBitsQuantizer,
)
from segment_anything import sam_model_registry
from segment_anything.modeling import Sam
from segment_anything.utils.onnx import SamOnnxModel

from parfocal_ml.sam_contract import (
    AIS,
    AIS_OUTPUT_SIZE,
    EMBED_DIM,
    EMBED_SIZE,
    GRAPHS,
    IMAGE_SIZE,
    MASK_INPUT_SIZE,
    OPSET,
    SAM,
    checkpoint_path,
    onnx_dir,
)
from parfocal_ml.sam_onnx.instance_decoder import InstanceDecoder


@dataclass(frozen=True)
class Exported:
    name: str
    megabytes: float
    seconds: float


def load_sam() -> Sam:
    state = torch.load(checkpoint_path(SAM), map_location="cpu", weights_only=False)
    if isinstance(state, dict) and "model_state" in state:
        state = state["model_state"]
    sam = sam_model_registry["vit_b"]()
    sam.load_state_dict(state, strict=True)
    return sam.eval()


def load_instance_decoder() -> InstanceDecoder:
    decoder = InstanceDecoder()
    state = torch.load(checkpoint_path(AIS), map_location="cpu", weights_only=False)
    decoder.load_state_dict(state, strict=True)
    return decoder.eval()


class Encoder(torch.nn.Module):
    def __init__(self, sam: Sam) -> None:
        super().__init__()
        self.image_encoder = sam.image_encoder

    def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
        return self.image_encoder(pixel_values)


class BatchDecoder(torch.nn.Module):
    def __init__(self, sam: Sam) -> None:
        super().__init__()
        self.wrapper = SamOnnxModel(sam, return_single_mask=False)

    @torch.no_grad()
    def forward(
        self, image_embeddings: torch.Tensor, point_coords: torch.Tensor, point_labels: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor]:
        prompt = self.wrapper.model.prompt_encoder
        sparse = self.wrapper._embed_points(point_coords, point_labels)
        size = image_embeddings.shape[-1]
        dense = prompt.no_mask_embed.weight.reshape(1, -1, 1, 1).expand(1, -1, size, size)
        masks, scores = self.wrapper.model.mask_decoder.predict_masks(
            image_embeddings=image_embeddings,
            image_pe=prompt.get_dense_pe(),
            sparse_prompt_embeddings=sparse,
            dense_prompt_embeddings=dense,
        )
        best = scores.argmax(dim=1)
        index = best.view(-1, 1, 1, 1).expand(-1, 1, masks.shape[2], masks.shape[3])
        return masks.gather(1, index).squeeze(1), scores.gather(1, best.view(-1, 1)).squeeze(1)


class AisDecoder(torch.nn.Module):
    def __init__(self, decoder: InstanceDecoder) -> None:
        super().__init__()
        self.decoder = decoder

    def forward(self, image_embeddings: torch.Tensor) -> torch.Tensor:
        maps = self.decoder(image_embeddings)
        return torch.nn.functional.avg_pool2d(maps, maps.shape[-1] // AIS_OUTPUT_SIZE)


def embeddings_dummy() -> torch.Tensor:
    return torch.randn(1, EMBED_DIM, EMBED_SIZE, EMBED_SIZE)


def trace(model: torch.nn.Module, args: tuple[Any, ...], target: Path, **options: Any) -> Exported:
    started = time.perf_counter()
    torch.onnx.export(
        model,
        args,
        str(target),
        opset_version=OPSET,
        do_constant_folding=True,
        dynamo=False,
        **options,
    )
    return Exported(target.name, target.stat().st_size / 1e6, time.perf_counter() - started)


def export_encoder(sam: Sam, folder: Path) -> Exported:
    return trace(
        Encoder(sam),
        (torch.randn(1, 3, IMAGE_SIZE, IMAGE_SIZE),),
        folder / GRAPHS.encoder,
        input_names=["pixel_values"],
        output_names=["image_embeddings"],
    )


def export_decoder(sam: Sam, folder: Path) -> Exported:
    feeds = {
        "image_embeddings": embeddings_dummy(),
        "point_coords": torch.randint(0, IMAGE_SIZE, (1, 5, 2), dtype=torch.float),
        "point_labels": torch.randint(0, 4, (1, 5), dtype=torch.float),
        "mask_input": torch.randn(1, 1, MASK_INPUT_SIZE, MASK_INPUT_SIZE),
        "has_mask_input": torch.tensor([1], dtype=torch.float),
        "orig_im_size": torch.tensor([IMAGE_SIZE, IMAGE_SIZE], dtype=torch.float),
    }
    return trace(
        SamOnnxModel(sam, return_single_mask=False),
        tuple(feeds.values()),
        folder / GRAPHS.decoder,
        input_names=list(feeds),
        output_names=["masks", "iou_predictions", "low_res_masks"],
        dynamic_axes={"point_coords": {1: "num_points"}, "point_labels": {1: "num_points"}},
    )


def export_batch_decoder(sam: Sam, folder: Path) -> Exported:
    return trace(
        BatchDecoder(sam),
        (
            embeddings_dummy(),
            torch.randint(0, IMAGE_SIZE, (3, 2, 2), dtype=torch.float),
            torch.tensor([[1, -1], [2, 3], [1, 0]], dtype=torch.float),
        ),
        folder / GRAPHS.batch_decoder,
        input_names=["image_embeddings", "point_coords", "point_labels"],
        output_names=["low_res_masks", "iou_predictions"],
        dynamic_axes={
            "point_coords": {0: "prompts", 1: "num_points"},
            "point_labels": {0: "prompts", 1: "num_points"},
            "low_res_masks": {0: "prompts"},
            "iou_predictions": {0: "prompts"},
        },
    )


def export_ais_decoder(decoder: InstanceDecoder, folder: Path) -> Exported:
    return trace(
        AisDecoder(decoder),
        (embeddings_dummy(),),
        folder / GRAPHS.ais_decoder,
        input_names=["image_embeddings"],
        output_names=["maps"],
    )


def quantise_uint8(folder: Path) -> Exported:
    target = folder / GRAPHS.encoder_uint8
    started = time.perf_counter()
    quantize_dynamic(
        model_input=str(folder / GRAPHS.encoder),
        model_output=str(target),
        weight_type=QuantType.QUInt8,
        per_channel=True,
        extra_options={"MatMulConstBOnly": True},
    )
    return Exported(target.name, target.stat().st_size / 1e6, time.perf_counter() - started)


def quantise_q4(folder: Path) -> Exported:
    target = folder / GRAPHS.encoder_q4
    started = time.perf_counter()
    config = DefaultWeightOnlyQuantConfig(
        block_size=32, is_symmetric=True, bits=4, accuracy_level=4
    )
    quantizer = MatMulNBitsQuantizer(onnx.load(str(folder / GRAPHS.encoder)), algo_config=config)
    quantizer.process()
    quantizer.model.save_model_to_file(str(target), use_external_data_format=False)
    return Exported(target.name, target.stat().st_size / 1e6, time.perf_counter() - started)


def export_all(folder: Path) -> list[Exported]:
    folder.mkdir(parents=True, exist_ok=True)
    sam = load_sam()
    with torch.no_grad():
        exported = [
            export_encoder(sam, folder),
            export_decoder(sam, folder),
            export_batch_decoder(sam, folder),
            export_ais_decoder(load_instance_decoder(), folder),
        ]
    return [*exported, quantise_uint8(folder), quantise_q4(folder)]


def main() -> int:
    parser = argparse.ArgumentParser(description="Export PathoSAM to the browser ONNX graphs")
    parser.add_argument("--out", type=Path, default=onnx_dir())
    args = parser.parse_args()
    for graph in export_all(args.out):
        print(f"{graph.name:<32} {graph.megabytes:7.1f} MB {graph.seconds:6.1f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
