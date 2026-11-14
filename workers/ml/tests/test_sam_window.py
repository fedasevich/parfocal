import numpy as np
import pytest

pytest.importorskip("torch")
pytest.importorskip("onnxruntime")
pytest.importorskip("segment_anything")

import torch
from segment_anything.modeling import MaskDecoder, PromptEncoder, Sam, TwoWayTransformer
from segment_anything.utils.onnx import SamOnnxModel

from parfocal_ml.sam_contract import (
    AIS,
    EMBED_DIM,
    EMBED_SIZE,
    IMAGE_SIZE,
    SAM,
    MissingCheckpointError,
    checkpoint_path,
    onnx_dir,
    window_decoder_graph,
)
from parfocal_ml.sam_onnx.window_check import pasted, touches_inner_edge, window_origin
from parfocal_ml.sam_onnx.window_decoder import WindowDecoder, window_dummies


class StubEncoder(torch.nn.Module):
    img_size = IMAGE_SIZE


def random_sam() -> Sam:
    torch.manual_seed(20261114)
    prompt = PromptEncoder(
        embed_dim=EMBED_DIM,
        image_embedding_size=(EMBED_SIZE, EMBED_SIZE),
        input_image_size=(IMAGE_SIZE, IMAGE_SIZE),
        mask_in_chans=16,
    )
    decoder = MaskDecoder(
        num_multimask_outputs=3,
        transformer=TwoWayTransformer(depth=2, embedding_dim=EMBED_DIM, mlp_dim=2048, num_heads=8),
        transformer_dim=EMBED_DIM,
        iou_head_depth=3,
        iou_head_hidden_dim=256,
    )
    return Sam(image_encoder=StubEncoder(), prompt_encoder=prompt, mask_decoder=decoder).eval()


@pytest.fixture(scope="module")
def sam() -> Sam:
    return random_sam()


def feeds(origin: tuple[int, int]) -> tuple:
    torch.manual_seed(7)
    embeddings, _, _, mask_input, _, _ = window_dummies()
    coords = torch.tensor([[[500.0, 420.0], [0.0, 0.0]]])
    labels = torch.tensor([[1.0, -1.0]])
    return (
        embeddings,
        coords,
        labels,
        mask_input,
        torch.tensor([1.0]),
        torch.tensor([float(origin[0]), float(origin[1])]),
    )


def test_a_window_over_the_whole_grid_matches_the_full_decoder(sam: Sam) -> None:
    inputs = feeds((0, 0))
    masks, scores, low_res = WindowDecoder(sam, EMBED_SIZE)(*inputs)
    full = SamOnnxModel(sam, return_single_mask=False)
    size = torch.tensor([IMAGE_SIZE, IMAGE_SIZE], dtype=torch.float)
    with torch.no_grad():
        full_masks, full_scores, full_low_res = full(*inputs[:5], size)
    torch.testing.assert_close(low_res, full_low_res, atol=1e-5, rtol=1e-5)
    torch.testing.assert_close(scores, full_scores, atol=1e-5, rtol=1e-5)
    torch.testing.assert_close(masks, full_masks, atol=1e-4, rtol=1e-4)


def test_a_smaller_window_returns_window_sized_masks(sam: Sam) -> None:
    masks, scores, low_res = WindowDecoder(sam, 32)(*feeds((8, 16)))
    assert tuple(low_res.shape) == (1, 4, 128, 128)
    assert tuple(masks.shape) == (1, 4, 512, 512)
    assert tuple(scores.shape) == (1, 4)


def test_the_window_sees_only_the_tokens_it_crops(sam: Sam) -> None:
    decoder = WindowDecoder(sam, 16)
    inputs = list(feeds((10, 20)))
    first = decoder(*inputs)[2]
    changed = inputs[0].clone()
    changed[:, :, :20, :] += 5.0
    changed[:, :, :, :10] += 5.0
    inputs[0] = changed
    torch.testing.assert_close(decoder(*inputs)[2], first)


def test_a_window_outside_the_grid_is_refused(sam: Sam) -> None:
    with pytest.raises(ValueError, match="window must hold"):
        WindowDecoder(sam, EMBED_SIZE + 1)


def test_the_exported_window_follows_the_origin_it_is_given(sam: Sam, tmp_path) -> None:
    import onnxruntime as ort

    from parfocal_ml.sam_onnx.export import export_window_decoder

    exported = export_window_decoder(sam, tmp_path, 24)
    assert exported.name == window_decoder_graph(24)
    graph = ort.InferenceSession(str(tmp_path / exported.name), providers=["CPUExecutionProvider"])
    for origin in [(0, 0), (17, 5), (40, 40)]:
        inputs = feeds(origin)
        eager = WindowDecoder(sam, 24)(*inputs)
        names = [entry.name for entry in graph.get_inputs()]
        onnx = graph.run(None, dict(zip(names, (value.numpy() for value in inputs), strict=True)))
        for got, expected in zip(onnx, eager, strict=True):
            np.testing.assert_allclose(got, expected.numpy(), atol=1e-4, rtol=1e-4)


def test_the_origin_centres_the_click_and_stays_on_the_grid() -> None:
    assert window_origin(512, 512, 32) == (16, 16)
    assert window_origin(0, 1023, 32) == (0, 32)
    assert window_origin(1023, 0, 16) == (48, 0)


def test_a_pasted_window_lands_at_its_origin() -> None:
    window = np.ones((512, 512), dtype=np.float32)
    full = pasted(window, (16, 8), 32)
    assert full.shape == (IMAGE_SIZE, IMAGE_SIZE)
    assert full[128, 256] == 1
    assert full[127, 256] < 0
    assert full[128 + 511, 256 + 511] == 1
    assert full[128 + 512, 256] < 0


def test_a_mask_on_an_inner_window_edge_is_flagged() -> None:
    mask = np.zeros((512, 512), dtype=bool)
    mask[200:300, 200:300] = True
    assert not touches_inner_edge(mask, (16, 16), 32)
    mask[0, 250] = True
    assert touches_inner_edge(mask, (16, 16), 32)
    assert not touches_inner_edge(mask, (16, 0), 32)


@pytest.mark.weights
def test_the_window_decoder_agrees_with_the_full_one_on_tnbc() -> None:
    try:
        checkpoint_path(SAM)
        checkpoint_path(AIS)
    except MissingCheckpointError as missing:
        pytest.skip(str(missing))
    from parfocal_ml.sam_onnx.export import export_window_decoder, load_sam
    from parfocal_ml.sam_onnx.verify import tnbc_patches
    from parfocal_ml.sam_onnx.window_check import check_window

    folder = onnx_dir()
    if not (folder / window_decoder_graph(32)).exists():
        export_window_decoder(load_sam(), folder, 32)
    report = check_window(tnbc_patches(8), 10, folder, 32)
    assert report.passed, report.summary()
