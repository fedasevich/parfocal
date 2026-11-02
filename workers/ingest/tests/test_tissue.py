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
from parfocal_ingest.tissue import TissueBox, TissueMask, box_of, mask_of, tissue_mask

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


def all_cells_box(mask: TissueMask) -> TissueBox:
    rows = np.flatnonzero(mask.cells.any(axis=1))
    cols = np.flatnonzero(mask.cells.any(axis=0))
    top, left = int(rows[0]) * mask.cell, int(cols[0]) * mask.cell
    bottom, right = (int(rows[-1]) + 1) * mask.cell, (int(cols[-1]) + 1) * mask.cell
    return TissueBox(left, top, right - left, bottom - top)


def area(box: TissueBox) -> int:
    return box.width * box.height


def inside(box: TissueBox, cell: int, cells: NDArray[np.bool_]) -> float:
    top, left = box.y // cell, box.x // cell
    bottom, right = math.ceil((box.y + box.height) / cell), math.ceil((box.x + box.width) / cell)
    return float(cells[top:bottom, left:right].sum() / cells.sum())


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


@pytest.mark.parametrize("name", ["tumor_009.tif", "test_001.tif"])
def test_the_box_ignores_specks_and_keeps_the_tumour(name: str, tmp_path: Path) -> None:
    _, mask, _ = masked(name, tmp_path)
    assert mask.box is not None
    assert area(mask.box) < area(all_cells_box(mask))
    tumour = tumour_cells(name, mask.cell, mask.cells.shape)
    assert inside(mask.box, mask.cell, tumour) > 0.98


def test_the_box_of_cmu1_is_tighter_than_all_cells(tmp_path: Path) -> None:
    pyramid, mask, _ = masked("CMU-1.svs", tmp_path)
    base = pyramid.levels[0]
    assert mask.box is not None
    whole = all_cells_box(mask)
    assert area(mask.box) < area(whole)
    assert whole.x <= mask.box.x
    assert whole.y <= mask.box.y
    assert mask.box.x + mask.box.width <= min(whole.x + whole.width, base.width)
    assert mask.box.y + mask.box.height <= min(whole.y + whole.height, base.height)
    assert inside(mask.box, mask.cell, mask.cells) > 0.99


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


def test_a_stray_speck_does_not_stretch_the_box() -> None:
    cells = np.zeros((300, 320), dtype=np.bool_)
    cells[50:250, 60:260] = True
    cells[2:5, 2:5] = True
    cells[296:299, 315:318] = True
    assert box_of(cells, 64, 320 * 64, 300 * 64) == TissueBox(60 * 64, 50 * 64, 200 * 64, 200 * 64)


def test_many_small_pieces_are_all_kept() -> None:
    cells = np.zeros((100, 100), dtype=np.bool_)
    cells[1::2, 1::2] = True
    assert box_of(cells, 10, 1000, 1000) == TissueBox(10, 10, 990, 990)


def test_the_box_is_clipped_to_the_slide() -> None:
    cells = np.ones((3, 4), dtype=np.bool_)
    assert box_of(cells, 64, 200, 150) == TissueBox(0, 0, 200, 150)


def test_glass_has_no_box() -> None:
    assert box_of(np.zeros((5, 5), dtype=np.bool_), 64, 320, 320) is None
