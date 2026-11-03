from pathlib import Path

import numpy as np
import tifffile
from make_synthetic import PIXELS_PER_CENTIMETRE, SYNTHETIC, TILE, base_image, pyramid
from make_synthetic_codecs import merge_manifest

MACRO_WIDTH = 1536
MACRO_HEIGHT = 2048
MACRO_FACTOR = 4
COLLECTION_NM = (26564529, 76734666)
MAIN_VIEW_NM = (512000, 384000)
MAIN_OFFSET_NM = (5389341, 17548313)
NAMESPACE = "http://www.leica-microsystems.com/scn/2010/10/01"


def macro_levels() -> list[np.ndarray]:
    macro = np.full((MACRO_HEIGHT, MACRO_WIDTH, 3), 128, dtype=np.uint8)
    macro[64:448, 64 : MACRO_WIDTH - 64] = (32, 32, 32)
    small = macro[::MACRO_FACTOR, ::MACRO_FACTOR].copy()
    return [macro, small]


def dimensions(levels: list[np.ndarray], first_ifd: int) -> str:
    return "\n".join(
        f'        <dimension sizeX="{level.shape[1]}" sizeY="{level.shape[0]}" '
        f'r="{r}" ifd="{first_ifd + r}" />'
        for r, level in enumerate(levels)
    )


def scn_xml(macro: list[np.ndarray], main: list[np.ndarray]) -> str:
    collection_x, collection_y = COLLECTION_NM
    view_x, view_y = MAIN_VIEW_NM
    offset_x, offset_y = MAIN_OFFSET_NM
    offsets = f'offsetX="{offset_x}" offsetY="{offset_y}"'
    return f"""<?xml version="1.0"?>
<scn xmlns="{NAMESPACE}">
  <collection name="synthetic" sizeX="{collection_x}" sizeY="{collection_y}">
    <image name="macro">
      <pixels sizeX="{MACRO_WIDTH}" sizeY="{MACRO_HEIGHT}">
{dimensions(macro, 0)}
      </pixels>
      <view sizeX="{collection_x}" sizeY="{collection_y}" offsetX="0" offsetY="0" spacingZ="0" />
    </image>
    <image name="main">
      <pixels sizeX="{main[0].shape[1]}" sizeY="{main[0].shape[0]}">
{dimensions(main, len(macro))}
      </pixels>
      <view sizeX="{view_x}" sizeY="{view_y}" {offsets} spacingZ="400" />
    </image>
  </collection>
</scn>
"""


def write_scn(path: Path) -> None:
    macro = macro_levels()
    main = pyramid(base_image())
    description = scn_xml(macro, main)
    pages = [(level, MACRO_FACTOR**index * 32) for index, level in enumerate(macro)]
    pages += [(level, 2**index) for index, level in enumerate(main)]
    with tifffile.TiffWriter(path, bigtiff=False) as tiff:
        for index, (level, scale) in enumerate(pages):
            tiff.write(
                level,
                photometric="rgb",
                tile=(TILE, TILE),
                compression="jpeg",
                compressionargs={"level": 90},
                resolution=(PIXELS_PER_CENTIMETRE / scale, PIXELS_PER_CENTIMETRE / scale),
                resolutionunit="CENTIMETER",
                description=description if index == 0 else None,
                metadata=None,
            )


def main() -> None:
    SYNTHETIC.mkdir(exist_ok=True)
    path = SYNTHETIC / "synthetic-decoy.scn"
    write_scn(path)
    merge_manifest([path])
    print(f"{path.name}: {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
