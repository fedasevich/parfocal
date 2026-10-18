import io
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

import openslide
import tifffile
from PIL import Image
from wsidicom import WsiDicom

from parfocal_ingest.pyramid import Pyramid, Reader
from parfocal_ingest.thumbnail import WHITE, flattened

MACRO_QUALITY = 90


class Kind(StrEnum):
    LABEL = "label"
    MACRO = "macro"


MEDIA_TYPES = {Kind.LABEL: "image/png", Kind.MACRO: "image/jpeg"}


@dataclass(frozen=True)
class Associated:
    kind: Kind
    width: int
    height: int
    media_type: str
    data: bytes


def encoded(kind: Kind, image: Image.Image) -> Associated:
    flat = flattened(image, WHITE)
    buffer = io.BytesIO()
    if kind is Kind.LABEL:
        flat.save(buffer, "PNG", optimize=True)
    else:
        flat.save(buffer, "JPEG", quality=MACRO_QUALITY, optimize=True)
    return Associated(kind, flat.width, flat.height, MEDIA_TYPES[kind], buffer.getvalue())


def from_openslide(path: Path) -> dict[Kind, Image.Image]:
    with openslide.OpenSlide(path) as slide:
        images = slide.associated_images
        return {kind: images[kind.value] for kind in Kind if kind.value in images}


def from_dicom(path: Path) -> dict[Kind, Image.Image]:
    found: dict[Kind, Image.Image] = {}
    with WsiDicom.open(path) as slide:
        if slide.labels:
            found[Kind.LABEL] = image_of(slide.read_label())
        if slide.overviews:
            found[Kind.MACRO] = image_of(slide.read_overview())
    return found


def image_of(value: object) -> Image.Image:
    if not isinstance(value, Image.Image):
        raise TypeError("expected an image")
    return value


def from_ome(path: Path) -> dict[Kind, Image.Image]:
    found: dict[Kind, Image.Image] = {}
    with tifffile.TiffFile(path) as tiff:
        for series in tiff.series:
            name = series.name.strip().lower()
            for kind in Kind:
                if name == kind.value and kind not in found:
                    found[kind] = Image.fromarray(series.asarray())
    return found


def associated_images(path: Path, pyramid: Pyramid) -> tuple[Associated, ...]:
    match pyramid.reader:
        case Reader.OPENSLIDE:
            images = from_openslide(path)
        case Reader.WSIDICOM:
            images = from_dicom(path)
        case Reader.TIFFSLIDE:
            images = from_ome(path)
    return tuple(encoded(kind, images[kind]) for kind in Kind if kind in images)
