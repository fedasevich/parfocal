import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from slide_support import opened

from parfocal_ingest.associated import Kind, associated_images
from parfocal_ingest.pyramid import Pyramid, read_pyramid

PRESENT = {
    "CMU-1-Small-Region.svs": {Kind.LABEL: (387, 463), Kind.MACRO: (1280, 431)},
    "CMU-1.svs": {Kind.LABEL: (387, 463), Kind.MACRO: (1280, 431)},
    "CMU-2.svs": {Kind.LABEL: (387, 463), Kind.MACRO: (1280, 431)},
    "JP2K-33003-1.svs": {Kind.LABEL: (415, 422), Kind.MACRO: (1280, 421)},
    "JP2K-33003-2.svs": {Kind.LABEL: (415, 422), Kind.MACRO: (1280, 421)},
    "CMU-1-JP2K-33005.svs": {Kind.LABEL: (387, 463), Kind.MACRO: (1280, 431)},
    "CMU-1.ndpi": {Kind.MACRO: (1191, 408)},
    "OS-1.ndpi": {Kind.MACRO: (1160, 396)},
    "Leica-1.scn": {Kind.MACRO: (1616, 4668)},
    "OS-1.bif": {Kind.MACRO: (1008, 3008)},
    "Huron-1-40x.tif": {Kind.LABEL: (250, 230), Kind.MACRO: (273, 530)},
    "Huron-1-Uncompressed.tif": {Kind.LABEL: (250, 230), Kind.MACRO: (273, 530)},
    "Argos-1.avs": {Kind.MACRO: (1489, 508)},
    "Philips-3.tiff": {Kind.LABEL: (387, 403), Kind.MACRO: (791, 403)},
    "Philips-4.tiff": {Kind.MACRO: (1816, 821)},
    "tumor_009.tif": {Kind.MACRO: (3629, 1577)},
    "CMU-1-Saved-1_16.zip": {Kind.LABEL: (615, 462), Kind.MACRO: (563, 1128)},
    "CMU-1-JP2K-33005-v2.zip": {Kind.LABEL: (387, 463), Kind.MACRO: (1280, 431)},
    "Leica-4.zip": {Kind.LABEL: (608, 547), Kind.MACRO: (1491, 605)},
    "CMU-1.tiff": {},
    "test_001.tif": {},
    "synthetic-jpeg.tiff": {},
    "synthetic-zlib.ome.tiff": {},
}
FORMATS = {Kind.LABEL: ("PNG", "image/png"), Kind.MACRO: ("JPEG", "image/jpeg")}


@pytest.mark.parametrize("name", list(PRESENT))
def test_labels_and_macros_are_extracted_where_present(name: str, tmp_path: Path) -> None:
    slide = opened(name, tmp_path)
    assert isinstance(slide, tuple), slide
    pyramid = read_pyramid(*slide)
    assert isinstance(pyramid, Pyramid), pyramid
    found = associated_images(slide[0], pyramid)
    assert {image.kind: (image.width, image.height) for image in found} == PRESENT[name]
    for image in found:
        decoded = Image.open(io.BytesIO(image.data))
        assert (decoded.format, image.media_type) == FORMATS[image.kind]
        assert (decoded.mode, decoded.size) == ("RGB", (image.width, image.height))
        assert float(np.asarray(decoded, dtype=np.float64).std()) > 5


def test_the_scn_macro_is_the_image_the_level_table_skips(tmp_path: Path) -> None:
    slide = opened("Leica-1.scn", tmp_path)
    assert isinstance(slide, tuple)
    pyramid = read_pyramid(*slide)
    assert isinstance(pyramid, Pyramid)
    (macro,) = associated_images(slide[0], pyramid)
    base = pyramid.levels[0]
    assert (macro.width, macro.height) == (1616, 4668) != (base.width, base.height)
