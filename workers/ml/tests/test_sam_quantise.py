import pytest

pytest.importorskip("torch")
pytest.importorskip("onnxruntime")

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper

from parfocal_ml.sam_onnx.export import dequantised_weights, int8_per_channel


def conv_model(weights: np.ndarray, transpose: np.ndarray) -> onnx.ModelProto:
    graph = helper.make_graph(
        [
            helper.make_node("Conv", ["x", "w"], ["y"], pads=[1, 1, 1, 1]),
            helper.make_node("ConvTranspose", ["y", "t"], ["z"], strides=[2, 2]),
        ],
        "convs",
        [helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 4, 8, 8])],
        [helper.make_tensor_value_info("z", TensorProto.FLOAT, [1, 2, 16, 16])],
        [numpy_helper.from_array(weights, "w"), numpy_helper.from_array(transpose, "t")],
    )
    return helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], ir_version=8)


def test_int8_per_channel_scales_each_output_channel_to_its_own_peak() -> None:
    weights = np.stack([np.full((2, 3, 3), 0.5), np.full((2, 3, 3), -2.0)]).astype(np.float32)
    quantised, scale = int8_per_channel(weights, 0)
    assert quantised.dtype == np.int8
    np.testing.assert_allclose(scale, [0.5 / 127, 2.0 / 127], rtol=1e-6)
    assert quantised[0].max() == 127
    assert quantised[1].min() == -127


def test_weight_only_int8_graph_matches_fp32_within_quantisation_noise() -> None:
    generator = np.random.default_rng(7)
    weights = generator.normal(size=(6, 4, 3, 3)).astype(np.float32)
    transpose = generator.normal(size=(6, 2, 2, 2)).astype(np.float32)
    model = conv_model(weights, transpose)
    quantised = dequantised_weights(conv_model(weights, transpose))
    onnx.checker.check_model(quantised)
    assert [node.op_type for node in quantised.graph.node].count("DequantizeLinear") == 2
    assert TensorProto.INT8 in {tensor.data_type for tensor in quantised.graph.initializer}
    x = generator.normal(size=(1, 4, 8, 8)).astype(np.float32)
    expected = np.asarray(ort.InferenceSession(model.SerializeToString()).run(None, {"x": x})[0])
    got = np.asarray(ort.InferenceSession(quantised.SerializeToString()).run(None, {"x": x})[0])
    assert np.abs(expected - got).max() < 0.02 * np.abs(expected).max()
