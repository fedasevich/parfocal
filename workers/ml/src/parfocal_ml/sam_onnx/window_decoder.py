import torch
from segment_anything.modeling import Sam
from segment_anything.utils.onnx import SamOnnxModel

from parfocal_ml.sam_contract import (
    EMBED_DIM,
    EMBED_SIZE,
    IMAGE_SIZE,
    MASK_INPUT_SIZE,
    WINDOW_SIZE,
)

WINDOW_INPUTS = (
    "image_embeddings",
    "point_coords",
    "point_labels",
    "mask_input",
    "has_mask_input",
    "window_origin",
)
WINDOW_OUTPUTS = ("masks", "iou_predictions", "low_res_masks")
MASK_SCALE = 4


class WindowDecoder(torch.nn.Module):
    def __init__(self, sam: Sam, size: int = WINDOW_SIZE) -> None:
        super().__init__()
        if not 0 < size <= EMBED_SIZE:
            raise ValueError(f"the window must hold 1 to {EMBED_SIZE} tokens a side")
        self.size = size
        self.wrapper = SamOnnxModel(sam, return_single_mask=False)

    def crop(self, grid: torch.Tensor, window_origin: torch.Tensor) -> torch.Tensor:
        offsets = torch.arange(self.size, dtype=torch.long)
        columns = window_origin[0].long() + offsets
        rows = window_origin[1].long() + offsets
        return grid.index_select(2, rows).index_select(3, columns)

    @torch.no_grad()
    def forward(
        self,
        image_embeddings: torch.Tensor,
        point_coords: torch.Tensor,
        point_labels: torch.Tensor,
        mask_input: torch.Tensor,
        has_mask_input: torch.Tensor,
        window_origin: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        model = self.wrapper.model
        sparse = self.wrapper._embed_points(point_coords, point_labels)
        dense = self.wrapper._embed_masks(mask_input, has_mask_input)
        low_res, scores = model.mask_decoder.predict_masks(
            image_embeddings=self.crop(image_embeddings, window_origin),
            image_pe=self.crop(model.prompt_encoder.get_dense_pe(), window_origin),
            sparse_prompt_embeddings=sparse,
            dense_prompt_embeddings=self.crop(dense, window_origin),
        )
        masks = torch.nn.functional.interpolate(
            low_res, scale_factor=float(MASK_SCALE), mode="bilinear", align_corners=False
        )
        return masks, scores, low_res


def window_dummies(points: int = 5) -> tuple[torch.Tensor, ...]:
    return (
        torch.randn(1, EMBED_DIM, EMBED_SIZE, EMBED_SIZE),
        torch.randint(0, IMAGE_SIZE, (1, points, 2), dtype=torch.float),
        torch.randint(0, 4, (1, points), dtype=torch.float),
        torch.randn(1, 1, MASK_INPUT_SIZE, MASK_INPUT_SIZE),
        torch.tensor([1], dtype=torch.float),
        torch.tensor([0, 0], dtype=torch.float),
    )
