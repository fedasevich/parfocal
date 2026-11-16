import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import openslide
import torch
from monai.networks.nets import TorchVisionFCModel

TILE_SIDE = 2240
OPSET = 17


def network(weights):
    net = TorchVisionFCModel("resnet18", num_classes=1, use_conv=True, pretrained=False)
    net.load_state_dict(torch.load(weights, map_location="cpu"))
    return net.eval()


def tile(slide_path):
    slide = openslide.OpenSlide(str(slide_path))
    rgba = np.asarray(slide.read_region((0, 0), 0, (TILE_SIDE, TILE_SIDE)))
    rgb = rgba[..., :3].copy()
    rgb[rgba[..., 3] == 0] = 255
    return rgb


def batch(rgb):
    scaled = rgb.astype(np.float32) / 127.5 - 1.0
    return torch.from_numpy(np.ascontiguousarray(scaled.transpose(2, 0, 1)))[None]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("weights", type=Path)
    parser.add_argument("slide", type=Path)
    parser.add_argument("out", type=Path)
    arguments = parser.parse_args()
    net = network(arguments.weights)
    sample = batch(tile(arguments.slide))
    with torch.no_grad():
        expected = torch.sigmoid(net(sample))[0, 0].numpy()
    torch.onnx.export(
        net,
        (torch.zeros(1, 3, TILE_SIDE, TILE_SIDE),),
        str(arguments.out),
        input_names=["pixels"],
        output_names=["logits"],
        opset_version=OPSET,
        dynamo=False,
    )
    report = {
        "weights_sha256": hashlib.sha256(arguments.weights.read_bytes()).hexdigest(),
        "onnx_sha256": hashlib.sha256(arguments.out.read_bytes()).hexdigest(),
        "onnx_bytes": arguments.out.stat().st_size,
        "torch_shape": list(expected.shape),
    }
    try:
        import onnxruntime as ort

        session = ort.InferenceSession(str(arguments.out), providers=["CPUExecutionProvider"])
        logits = session.run(None, {"pixels": sample.numpy()})[0]
        got = 1 / (1 + np.exp(-logits[0, 0]))
        report["max_abs_difference"] = float(np.abs(got - expected).max())
    except ImportError:
        report["max_abs_difference"] = None
    np.save(arguments.out.with_suffix(".torch.npy"), expected)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
