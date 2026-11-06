import asyncio
import json
import time
from pathlib import Path

import numpy as np
import pytest
from fixture_support import fixture_path
from nuclei_support import ArrayReader
from scipy.spatial import KDTree

from parfocal_ml.nuclei import OnnxPathoSam, PathoSamDetector, Quality, weights_dir
from parfocal_ml.sam_contract import GRAPHS, onnx_dir
from parfocal_ml.whole_slide import Window

pytestmark = pytest.mark.weights

REFERENCE = Path(__file__).parent / "fixtures" / "pathosam-ais-cmu-1-small-region.json"


def polygon_area(ring: list[float]) -> float:
    xs, ys = np.array(ring[0::2]), np.array(ring[1::2])
    return 0.5 * abs(float(np.dot(xs, np.roll(ys, -1)) - np.dot(ys, np.roll(xs, -1))))


@pytest.fixture(scope="module")
def model() -> OnnxPathoSam:
    folder = weights_dir()
    if folder is None:
        pytest.skip(f"{GRAPHS.encoder} and {GRAPHS.ais_decoder_full} are not in {onnx_dir()}")
    return OnnxPathoSam(folder)


@pytest.fixture(scope="module")
def reader() -> ArrayReader:
    openslide = pytest.importorskip("openslide")
    slide = openslide.OpenSlide(str(fixture_path("CMU-1-Small-Region.svs")))
    pixels = np.asarray(slide.read_region((0, 0), 0, slide.dimensions).convert("RGB"))
    return ArrayReader(pixels, float(slide.properties["openslide.mpp-x"]))


def test_fixed_region_matches_the_pytorch_reference(model: OnnxPathoSam, reader: ArrayReader):
    reference = json.loads(REFERENCE.read_text())
    window = Window(*reference["window"])
    cells = asyncio.run(PathoSamDetector(reader, model, Quality.BEST).detect(window))
    expected = np.array(reference["nuclei"], float)
    assert abs(len(cells) - len(expected)) <= 0.01 * len(expected)
    centres = np.array([(np.mean(c.ring[0::2]), np.mean(c.ring[1::2])) for c in cells])
    distance, nearest = KDTree(centres).query(expected[:, :2])
    assert (distance < 1).mean() >= 0.95
    scale = (reference["model_size"][0] / window.width) ** 2
    ratios = [
        polygon_area(cells[index].ring) * scale / expected[row, 2]
        for row, index in enumerate(np.asarray(nearest).tolist())
        if distance[row] < 1
    ]
    assert 0.95 < float(np.median(ratios)) < 1.05


@pytest.mark.parametrize("quality", [Quality.BEST, Quality.FAST])
def test_throughput_in_seconds_per_square_millimetre(
    model: OnnxPathoSam, reader: ArrayReader, quality: Quality
):
    window = Window(300, 700, 1536, 1536)
    detector = PathoSamDetector(reader, model, quality)
    asyncio.run(detector.detect(Window(0, 0, 256, 256)))
    started = time.perf_counter()
    cells = asyncio.run(detector.detect(window))
    seconds = time.perf_counter() - started
    square_mm = window.width * window.height * reader.mpp**2 / 1e6
    print(
        f"{quality.name} {quality.mpp} um/px: {len(cells)} nuclei in {seconds:.2f} s "
        f"over {square_mm:.4f} mm2, {seconds / square_mm:.1f} s/mm2"
    )
    assert cells
