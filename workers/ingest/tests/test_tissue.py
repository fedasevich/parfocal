import math
import os
from pathlib import Path
from xml.etree import ElementTree

import numpy as np
import pytest
from fixture_support import fixture_path
from numpy.typing import NDArray
from PIL import Image, ImageDraw
from slide_support import opened

from parfocal_ingest.pyramid import Pyramid, read_pyramid
from parfocal_ingest.thumbnail import region_for
from parfocal_ingest.tissue import TissueMask, mask_of, tissue_mask

GOLDEN = Path(__file__).resolve().parent / "golden" / "tissue"
GLASS_LEVEL = 220


def masked(name: str, workdir: Path) -> tuple[Pyramid, TissueMask, NDArray[np.bool_]]:
    slide = opened(name, workdir)
    assert isinstance(slide, tuple), slide
    path, found = slide
    pyramid = read_pyramid(path, found)
    assert isinstance(pyramid, Pyramid)
    assert found.format is not None
    mask = tissue_mask(path, found.format, pyramid)
    rows, cols = mask.cells.shape
    image = region_for(path, found.format, pyramid, max(rows, cols))
    rgb = np.asarray(image.resize((cols, rows), Image.Resampling.BOX))
    return pyramid, mask, rgb.min(axis=2) > GLASS_LEVEL


def tumour_cells(name: str, cell: int, shape: tuple[int, ...]) -> NDArray[np.bool_]:
    root = ElementTree.parse(fixture_path(name.replace(".tif", ".xml"))).getroot()
    raster = Image.new("1", (shape[1], shape[0]), 0)
    draw = ImageDraw.Draw(raster)
    for annotation in root.iter("Annotation"):
        points = [
            (float(point.get("X", 0)) / cell, float(point.get("Y", 0)) / cell)
            for point in annotation.iter("Coordinate")
        ]
        if annotation.get("PartOfGroup") == "Tumor" and len(points) > 2:
            draw.polygon(points, fill=1)
    return np.asarray(raster)


def golden_for(name: str, mask: TissueMask) -> NDArray[np.bool_]:
    path = GOLDEN / f"{name}.png"
    if os.environ.get("PARFOCAL_UPDATE_GOLDEN") == "1":
        GOLDEN.mkdir(parents=True, exist_ok=True)
        path.write_bytes(mask.png())
    return np.asarray(Image.open(path)) > 0


@pytest.mark.parametrize("name", ["tumor_009.tif", "test_001.tif"])
def test_the_mask_covers_annotated_tumour_and_leaves_glass(name: str, tmp_path: Path) -> None:
    pyramid, mask, glass = masked(name, tmp_path)
    base = pyramid.levels[0]
    assert mask.cells.shape == (math.ceil(base.height / 64), math.ceil(base.width / 64))
    tumour = tumour_cells(name, mask.cell, mask.cells.shape)
    assert tumour.sum() > 0
    assert (mask.cells & tumour).sum() / tumour.sum() > 0.98
    assert (mask.cells & glass).sum() / glass.sum() < 0.02
    golden = golden_for(name, mask)
    assert golden.shape == mask.cells.shape
    assert (golden & mask.cells).sum() / (golden | mask.cells).sum() > 0.99


def test_a_small_slide_gets_a_plausible_mask(tmp_path: Path) -> None:
    _, mask, glass = masked("CMU-1-Small-Region.svs", tmp_path)
    assert 0.05 < mask.fraction < 0.95
    assert (mask.cells & glass).sum() / max(1, glass.sum()) < 0.15


def test_empty_glass_has_no_tissue() -> None:
    noise = np.random.default_rng(7).integers(235, 256, (200, 300, 3), dtype=np.uint8)
    threshold, cells = mask_of(Image.fromarray(noise))
    assert threshold >= 20
    assert not cells.any()


def test_a_stained_patch_is_found_with_a_margin() -> None:
    image = Image.new("RGB", (100, 100), (245, 245, 245))
    ImageDraw.Draw(image).rectangle((40, 30, 59, 49), fill=(200, 120, 190))
    _, cells = mask_of(image)
    assert cells[30:50, 40:60].all()
    assert cells.sum() == 22 * 22
