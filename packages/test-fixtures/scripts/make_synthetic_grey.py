from pathlib import Path

import numpy as np
import tifffile
from make_synthetic import LEVELS, PIXELS_PER_CENTIMETRE, SYNTHETIC, TILE, base_image
from make_synthetic_codecs import merge_manifest

LUMA_WEIGHTS = (0.299, 0.587, 0.114)


def grey_image() -> np.ndarray:
    luma = base_image().astype(np.float64) @ np.array(LUMA_WEIGHTS)
    return np.round(luma).astype(np.uint8)


def grey_pyramid(image: np.ndarray) -> list[np.ndarray]:
    levels = [image]
    for _ in range(1, LEVELS):
        previous = levels[-1].astype(np.uint16)
        height, width = previous.shape[0] // 2, previous.shape[1] // 2
        blocks = previous[: height * 2, : width * 2].reshape(height, 2, width, 2)
        levels.append(((blocks.sum(axis=(1, 3)) + 2) // 4).astype(np.uint8))
    return levels


def write_grey_tiff(path: Path, levels: list[np.ndarray]) -> None:
    with tifffile.TiffWriter(path) as tiff:
        for index, level in enumerate(levels):
            scale = 2**index
            tiff.write(
                level,
                photometric="minisblack",
                tile=(TILE, TILE),
                compression="zlib",
                subfiletype=1 if index else 0,
                resolution=(PIXELS_PER_CENTIMETRE / scale, PIXELS_PER_CENTIMETRE / scale),
                resolutionunit="CENTIMETER",
                description="Parfocal synthetic grey slide" if index == 0 else None,
            )


def main() -> None:
    SYNTHETIC.mkdir(exist_ok=True)
    path = SYNTHETIC / "synthetic-grey.tiff"
    write_grey_tiff(path, grey_pyramid(grey_image()))
    merge_manifest([path])
    print(f"{path.name}: {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
