import hashlib
import json
from pathlib import Path

import numpy as np
import tifffile
from make_synthetic import (
    HEIGHT,
    LEVELS,
    MANIFEST,
    MICRONS_PER_PIXEL,
    PIXELS_PER_CENTIMETRE,
    SYNTHETIC,
    TILE,
    WIDTH,
    base_image,
    pyramid,
)

CHANNELS = ("DAPI", "FITC", "TRITC")
CHANNEL_COLOURS = ((0, 0, 255), (0, 255, 0), (255, 0, 0))
MXIF_CHANNELS = ("Hoechst", "Laminin", "Synaptopodin", "THP")
MXIF_COLOURS = ((0, 0, 255), (0, 255, 0), (255, 0, 0), (255, 255, 0))
MXIF_TILE = 32
J2K_QUALITY = 70
DAMAGED_TILES = {"no-marker": 1, "garbled-body": 6}


def packed_colour(red: int, green: int, blue: int) -> int:
    value = (red << 24) | (green << 16) | (blue << 8) | 0xFF
    return value - (1 << 32) if value >= 1 << 31 else value


def write_jpeg2000(path: Path, levels: list[np.ndarray], compression: int) -> None:
    with tifffile.TiffWriter(path) as tiff:
        for index, level in enumerate(levels):
            scale = 2**index
            tiff.write(
                level,
                photometric="rgb",
                tile=(TILE, TILE),
                compression=compression,
                compressionargs={
                    "level": J2K_QUALITY,
                    "reversible": False,
                    "mct": True,
                    "codecformat": "J2K",
                },
                subfiletype=1 if index else 0,
                resolution=(PIXELS_PER_CENTIMETRE / scale, PIXELS_PER_CENTIMETRE / scale),
                resolutionunit="CENTIMETER",
                description="Parfocal synthetic slide" if index == 0 else None,
            )


def write_damaged_jpeg2000(path: Path, levels: list[np.ndarray]) -> None:
    write_jpeg2000(path, levels, 33005)
    with tifffile.TiffFile(path) as tiff:
        page = tiff.pages[0]
        offsets = list(page.dataoffsets)
        counts = list(page.databytecounts)
    with path.open("r+b") as file:
        file.seek(offsets[DAMAGED_TILES["no-marker"]])
        file.write(b"\x00\x00\x00\x00")
        body = offsets[DAMAGED_TILES["garbled-body"]] + 64
        file.seek(body)
        file.write(b"\xa5" * (counts[DAMAGED_TILES["garbled-body"]] - 64))


def channel_planes(dtype: np.dtype, count: int = len(CHANNELS)) -> np.ndarray:
    top = int(np.iinfo(dtype).max)
    y, x = np.mgrid[0:HEIGHT, 0:WIDTH]
    planes = np.zeros((count, HEIGHT, WIDTH), dtype=np.float64)
    planes[0] = x / (WIDTH - 1) * 0.6
    planes[1] = y / (HEIGHT - 1) * 0.6
    planes[2] = (((x // 128) + (y // 128)) % 2) * 0.5
    planes[0][32:96, 32:224] = 1.0
    planes[1][HEIGHT - 160 : HEIGHT - 32, WIDTH - 160 : WIDTH - 32] = 0.8
    planes[2][200:264, 400:464] = 1.0
    if count > len(CHANNELS):
        planes[3] = (x + y) / (WIDTH + HEIGHT - 2) * 0.9
        planes[3][HEIGHT - 96 : HEIGHT - 32, 32:160] = 1.0
    return np.round(planes * top).astype(dtype)


def channel_pyramid(planes: np.ndarray) -> list[np.ndarray]:
    levels = [planes]
    count = planes.shape[0]
    for _ in range(1, LEVELS):
        previous = levels[-1].astype(np.uint64)
        height, width = previous.shape[1] // 2, previous.shape[2] // 2
        blocks = previous[:, : height * 2, : width * 2].reshape(count, height, 2, width, 2)
        levels.append(((blocks.sum(axis=(2, 4)) + 2) // 4).astype(planes.dtype))
    return levels


def write_ome_channels(
    path: Path,
    levels: list[np.ndarray],
    names: tuple[str, ...] = CHANNELS,
    colours: tuple[tuple[int, int, int], ...] = CHANNEL_COLOURS,
    tile: int = TILE,
    byteorder: str = "<",
) -> None:
    options = {
        "photometric": "minisblack",
        "tile": (tile, tile),
        "compression": "zlib",
    }
    big_endian = byteorder == ">"
    with tifffile.TiffWriter(path, ome=True, bigtiff=big_endian, byteorder=byteorder) as tiff:
        tiff.write(
            levels[0],
            subifds=len(levels) - 1,
            resolution=(PIXELS_PER_CENTIMETRE, PIXELS_PER_CENTIMETRE),
            resolutionunit="CENTIMETER",
            metadata={
                "axes": "CYX",
                "Name": "Parfocal synthetic fluorescence",
                "PhysicalSizeX": MICRONS_PER_PIXEL,
                "PhysicalSizeXUnit": "µm",
                "PhysicalSizeY": MICRONS_PER_PIXEL,
                "PhysicalSizeYUnit": "µm",
                "Channel": {
                    "Name": list(names),
                    "Color": [packed_colour(*colour) for colour in colours],
                },
            },
            **options,
        )
        for index, level in enumerate(levels[1:], start=1):
            scale = 2**index
            tiff.write(
                level,
                subfiletype=1,
                resolution=(PIXELS_PER_CENTIMETRE / scale, PIXELS_PER_CENTIMETRE / scale),
                resolutionunit="CENTIMETER",
                **options,
            )


def merge_manifest(files: list[Path]) -> None:
    manifest = json.loads(MANIFEST.read_text())
    entries = {entry["file"]: entry for entry in manifest["synthetic"]}
    for path in files:
        entries[path.name] = {
            "file": path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size,
        }
    manifest["synthetic"] = list(entries.values())
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    SYNTHETIC.mkdir(exist_ok=True)
    levels = pyramid(base_image())
    jp2k_rgb = SYNTHETIC / "synthetic-jp2k-33005.tiff"
    jp2k_ycc = SYNTHETIC / "synthetic-jp2k-33003.tiff"
    jp2k_damaged = SYNTHETIC / "synthetic-jp2k-damaged.tiff"
    write_jpeg2000(jp2k_rgb, levels, 33005)
    write_jpeg2000(jp2k_ycc, levels, 33003)
    write_damaged_jpeg2000(jp2k_damaged, levels)
    files = [jp2k_rgb, jp2k_ycc, jp2k_damaged]
    for dtype in (np.uint8, np.uint16):
        path = SYNTHETIC / f"synthetic-channels-{np.dtype(dtype).name}.ome.tiff"
        write_ome_channels(path, channel_pyramid(channel_planes(np.dtype(dtype))))
        files.append(path)
    mxif = SYNTHETIC / "synthetic-mxif-uint16-be.ome.tiff"
    write_ome_channels(
        mxif,
        channel_pyramid(channel_planes(np.dtype(np.uint16), len(MXIF_CHANNELS))),
        names=MXIF_CHANNELS,
        colours=MXIF_COLOURS,
        tile=MXIF_TILE,
        byteorder=">",
    )
    files.append(mxif)
    merge_manifest(files)
    for path in files:
        print(f"{path.name}: {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
