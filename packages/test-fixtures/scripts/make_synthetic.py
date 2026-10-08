import hashlib
import json
from pathlib import Path

import numpy as np
import tifffile

PACKAGE = Path(__file__).resolve().parent.parent
SYNTHETIC = PACKAGE / "synthetic"
MANIFEST = PACKAGE / "fixtures.json"
WIDTH = 1024
HEIGHT = 768
LEVELS = 3
TILE = 256
MICRONS_PER_PIXEL = 0.5
PIXELS_PER_CENTIMETRE = 1e4 / MICRONS_PER_PIXEL


def base_image() -> np.ndarray:
    y, x = np.mgrid[0:HEIGHT, 0:WIDTH]
    image = np.empty((HEIGHT, WIDTH, 3), dtype=np.uint8)
    image[..., 0] = 236 - (x * 40 // WIDTH)
    image[..., 1] = 200 - (y * 60 // HEIGHT)
    image[..., 2] = 222
    image[(x % 128 < 2) | (y % 128 < 2)] = (120, 60, 140)
    image[32:96, 32:224] = (60, 20, 110)
    image[32:224, 32:96] = (60, 20, 110)
    image[HEIGHT - 160 : HEIGHT - 32, WIDTH - 160 : WIDTH - 32] = (200, 40, 90)
    return image


def pyramid(image: np.ndarray) -> list[np.ndarray]:
    levels = [image]
    for _ in range(1, LEVELS):
        previous = levels[-1].astype(np.uint16)
        height, width = previous.shape[0] // 2, previous.shape[1] // 2
        blocks = previous[: height * 2, : width * 2].reshape(height, 2, width, 2, 3)
        levels.append((blocks.mean(axis=(1, 3)) + 0.5).astype(np.uint8))
    return levels


def write_generic_tiff(path: Path, levels: list[np.ndarray]) -> None:
    with tifffile.TiffWriter(path) as tiff:
        for index, level in enumerate(levels):
            scale = 2**index
            tiff.write(
                level,
                photometric="rgb",
                tile=(TILE, TILE),
                compression="jpeg",
                compressionargs={"level": 90},
                subfiletype=1 if index else 0,
                resolution=(PIXELS_PER_CENTIMETRE / scale, PIXELS_PER_CENTIMETRE / scale),
                resolutionunit="CENTIMETER",
                description="Parfocal synthetic slide" if index == 0 else None,
            )


def write_ome_tiff(path: Path, levels: list[np.ndarray]) -> None:
    with tifffile.TiffWriter(path, ome=True) as tiff:
        tiff.write(
            levels[0],
            photometric="rgb",
            tile=(TILE, TILE),
            compression="zlib",
            subifds=len(levels) - 1,
            resolution=(PIXELS_PER_CENTIMETRE, PIXELS_PER_CENTIMETRE),
            resolutionunit="CENTIMETER",
            metadata={
                "axes": "YXS",
                "Name": "Parfocal synthetic slide",
                "PhysicalSizeX": MICRONS_PER_PIXEL,
                "PhysicalSizeXUnit": "µm",
                "PhysicalSizeY": MICRONS_PER_PIXEL,
                "PhysicalSizeYUnit": "µm",
            },
        )
        for index, level in enumerate(levels[1:], start=1):
            scale = 2**index
            tiff.write(
                level,
                photometric="rgb",
                tile=(TILE, TILE),
                compression="zlib",
                subfiletype=1,
                resolution=(PIXELS_PER_CENTIMETRE / scale, PIXELS_PER_CENTIMETRE / scale),
                resolutionunit="CENTIMETER",
            )


def update_manifest(files: list[Path]) -> None:
    manifest = json.loads(MANIFEST.read_text())
    manifest["synthetic"] = [
        {
            "file": path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size,
        }
        for path in files
    ]
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    SYNTHETIC.mkdir(exist_ok=True)
    levels = pyramid(base_image())
    generic = SYNTHETIC / "synthetic-jpeg.tiff"
    ome = SYNTHETIC / "synthetic-zlib.ome.tiff"
    write_generic_tiff(generic, levels)
    write_ome_tiff(ome, levels)
    update_manifest([generic, ome])
    for path in (generic, ome):
        print(f"{path.name}: {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
