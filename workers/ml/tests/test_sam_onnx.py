import pytest

pytest.importorskip("torch")
pytest.importorskip("onnxruntime")

from parfocal_ml.sam_contract import (
    AIS,
    AIS_MAX_ABS,
    FP32_MIN_IOU,
    GRAPHS,
    QUANTISED_MIN_IOU,
    SAM,
    MissingCheckpointError,
    checkpoint_path,
    onnx_dir,
)

pytestmark = pytest.mark.weights


@pytest.fixture(scope="module")
def report():
    try:
        checkpoint_path(SAM)
        checkpoint_path(AIS)
    except MissingCheckpointError as missing:
        pytest.skip(str(missing))
    from parfocal_ml.sam_onnx.export import export_all
    from parfocal_ml.sam_onnx.verify import tnbc_patches, verify

    folder = onnx_dir()
    if not all((folder / name).exists() for name in vars(GRAPHS).values()):
        export_all(folder)
    return verify(tnbc_patches(8), 10, folder)


def test_fp32_graphs_match_pytorch_exactly(report) -> None:
    fp32 = report.encoders[0]
    assert fp32.graph == GRAPHS.encoder
    assert fp32.passed, f"a pixel {fp32.flipped_max_logit} away from the threshold flipped"
    assert fp32.mean_iou > 0.999
    assert min(report.batch_ious) == FP32_MIN_IOU
    assert report.ais_max_abs < AIS_MAX_ABS


@pytest.mark.parametrize("graph", [GRAPHS.encoder_uint8, GRAPHS.encoder_q4])
def test_quantised_encoders_stay_close_to_pytorch(report, graph: str) -> None:
    encoder = next(encoder for encoder in report.encoders if encoder.graph == graph)
    assert encoder.passed
    assert encoder.mean_iou >= QUANTISED_MIN_IOU


@pytest.mark.parametrize("graph", [GRAPHS.ais_decoder_uint8, GRAPHS.ais_decoder_int8_weights])
def test_quantised_ais_decoders_keep_the_foreground(report, graph: str) -> None:
    ais = next(ais for ais in report.quantised_ais if ais.graph == graph)
    assert ais.passed, ais.summary()
