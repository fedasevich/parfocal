from pathlib import Path

import numpy as np
from PIL import Image

RESULTS = Path(__file__).resolve().parent / "results"
SLIDE_LEVEL_2 = (192, 256)
CELL_SIDE = 12
CELL_ROWS = (40, 90, 140)
CELL_COLUMNS = (60, 140)


def write_png(name: str, values: np.ndarray) -> None:
    Image.fromarray(values).save(RESULTS / name, optimize=True)


def off_level_mask() -> np.ndarray:
    values = np.zeros((48, 48), dtype=np.uint8)
    values[8:20, 8:20] = 1
    values[28:40, 24:44] = 2
    return values


def background_mask() -> np.ndarray:
    return np.zeros((64, 64), dtype=np.uint8)


def slide_cells_mask() -> np.ndarray:
    values = np.zeros(SLIDE_LEVEL_2, dtype=np.uint16)
    label = 0
    for top in CELL_ROWS:
        for left in CELL_COLUMNS:
            label += 1
            values[top : top + CELL_SIDE, left : left + CELL_SIDE] = label
    return values


def main() -> None:
    write_png("mask-off-level.png", off_level_mask())
    write_png("mask-background.png", background_mask())
    write_png("objects-check_instances.png", slide_cells_mask())


if __name__ == "__main__":
    main()
