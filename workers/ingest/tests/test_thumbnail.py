import io
import os
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from slide_support import opened
from test_pyramid import TABLES

from parfocal_ingest.pyramid import Pyramid, read_pyramid
from parfocal_ingest.thumbnail import OVERVIEW_SIDE, THUMBNAIL_SIDE, Previews, previews

GOLDEN = Path(__file__).resolve().parent / "golden" / "overviews"
GOLDEN_SIDE = 128
TOLERANCE = 3.0


def previews_of(name: str, workdir: Path) -> tuple[Pyramid, Previews]:
    slide = opened(name, workdir)
    assert isinstance(slide, tuple), slide
    path, found = slide
    pyramid = read_pyramid(path, found)
    assert isinstance(pyramid, Pyramid), pyramid
    assert found.format is not None
    return pyramid, previews(path, found.format, pyramid)


def decoded(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    assert (image.format, image.mode) == ("JPEG", "RGB")
    return image


def small(image: Image.Image) -> Image.Image:
    scale = GOLDEN_SIDE / max(image.size)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.Resampling.BOX)


def difference(first: Image.Image, second: Image.Image) -> float:
    assert first.size == second.size
    a = np.asarray(first.convert("RGB"), dtype=np.float64)
    b = np.asarray(second.convert("RGB"), dtype=np.float64)
    return float(np.abs(a - b).mean())


def golden_for(name: str, image: Image.Image) -> Image.Image:
    path = GOLDEN / f"{name}.png"
    if os.environ.get("PARFOCAL_UPDATE_GOLDEN") == "1":
        GOLDEN.mkdir(parents=True, exist_ok=True)
        image.save(path, optimize=True)
    return Image.open(path)


@pytest.mark.parametrize("name", list(TABLES))
def test_every_fixture_matches_its_golden_overview(name: str, tmp_path: Path) -> None:
    pyramid, made = previews_of(name, tmp_path)
    overview, thumbnail = decoded(made.overview), decoded(made.thumbnail)
    base = pyramid.levels[0]
    for image, side in ((overview, OVERVIEW_SIDE), (thumbnail, THUMBNAIL_SIDE)):
        assert max(image.size) == min(side, max(base.width, base.height))
        assert abs(image.width / image.height - base.width / base.height) < 2 / min(image.size)
    reduced = small(overview)
    assert difference(reduced, golden_for(name, reduced)) <= TOLERANCE


def test_the_dicom_copy_matches_the_svs_it_came_from(tmp_path: Path) -> None:
    _, svs = previews_of("CMU-1-JP2K-33005.svs", tmp_path / "svs")
    _, dicom = previews_of("CMU-1-JP2K-33005-v2.zip", tmp_path / "dicom")
    first, second = decoded(svs.overview), decoded(dicom.overview)
    assert difference(small(first), small(second)) <= TOLERANCE


def test_ycbcr_shown_as_rgb_fails_the_golden_check(tmp_path: Path) -> None:
    _, made = previews_of("JP2K-33003-1.svs", tmp_path)
    reduced = small(decoded(made.overview))
    misread = Image.frombytes("RGB", reduced.size, reduced.convert("YCbCr").tobytes())
    golden = Image.open(GOLDEN / "JP2K-33003-1.svs.png")
    assert difference(reduced, golden) <= TOLERANCE
    assert difference(misread, golden) > 10 * TOLERANCE
