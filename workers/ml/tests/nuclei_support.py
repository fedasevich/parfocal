from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from scipy import ndimage

from parfocal_ml.nuclei import Maps, Rgb
from parfocal_ml.whole_slide import Window


@dataclass
class ArrayReader:
    pixels: NDArray[np.uint8]
    mpp: float

    async def read(self, window: Window, width: int, height: int) -> Rgb:
        crop = self.pixels[window.y : window.bottom, window.x : window.right]
        if crop.shape[:2] == (height, width):
            return crop.copy()
        return np.asarray(Image.fromarray(crop).resize((width, height), Image.Resampling.BILINEAR))


class StainMaps:
    def __init__(self, radius: float) -> None:
        self.radius = radius
        self.shapes: list[tuple[int, int]] = []

    def maps(self, rgb: Rgb) -> Maps:
        self.shapes.append(rgb.shape[:2])
        dark = rgb.mean(axis=2) < 128
        distance = np.asarray(ndimage.distance_transform_edt(dark), np.float32)
        depth = np.clip(distance / self.radius, 0, 1)
        return np.stack([dark, 1 - depth, 1 - depth]).astype(np.float32)


def disks(
    height: int, width: int, centres: list[tuple[float, float]], radius: float
) -> NDArray[np.uint8]:
    ys, xs = np.mgrid[0:height, 0:width]
    image = np.full((height, width, 3), 240, np.uint8)
    for x, y in centres:
        image[(xs - x) ** 2 + (ys - y) ** 2 <= radius**2] = 60
    return image
