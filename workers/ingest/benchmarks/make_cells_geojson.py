import sys
from pathlib import Path
from typing import TextIO

import numpy as np

POC_JOB = Path("/Users/yuriifedas/WebstormProjects/poc/server/fixtures/wsi/tumor_009/synth0001503")
GRID = 4


def cell_feature(ring: np.ndarray, kind: int, score: int) -> str:
    closed = np.vstack((ring, ring[:1]))
    coords = ",".join(f"[{x:.2f},{y:.2f}]" for x, y in closed.tolist())
    return (
        '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[['
        f'{coords}]]}},"properties":{{"objectType":"cell",'
        f'"classification":{{"name":"type-{kind}"}},"score":{score / 255:.3f}}}}}'
    )


def region_feature(x: float, y: float, width: float, height: float) -> str:
    ring = [(x, y), (x + width, y), (x + width, y + height), (x, y + height), (x, y)]
    coords = ",".join(f"[{a:.1f},{b:.1f}]" for a, b in ring)
    return (
        '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[['
        f'{coords}]]}},"properties":{{"objectType":"annotation",'
        '"classification":{"name":"Tumor"}}}'
    )


def write_cells(handle: TextIO, limit: int) -> tuple[int, np.ndarray, np.ndarray]:
    written = 0
    low = np.array([np.inf, np.inf])
    high = np.array([-np.inf, -np.inf])
    for path in sorted(POC_JOB.glob("chunk-*.npz")):
        data = np.load(path)
        offsets = data["offsets"]
        points = data["points"].reshape(-1, 2)
        for index in range(min(int(data["count"]), limit - written)):
            ring = points[offsets[index] : offsets[index + 1]]
            low = np.minimum(low, ring.min(axis=0))
            high = np.maximum(high, ring.max(axis=0))
            feature = cell_feature(ring, int(data["types"][index]), int(data["scores"][index]))
            handle.write(("," if written else "") + feature)
            written += 1
        if written >= limit:
            break
    return written, low, high


def main(out: Path, limit: int) -> None:
    with out.open("w") as handle:
        handle.write('{"type":"FeatureCollection","features":[')
        written, low, high = write_cells(handle, limit)
        width, height = (high - low) / GRID
        for row in range(GRID):
            for column in range(GRID):
                x, y = low[0] + column * width, low[1] + row * height
                handle.write("," + region_feature(float(x), float(y), width, height))
        handle.write("]}")
    print(written, out.stat().st_size)


if __name__ == "__main__":
    main(Path(sys.argv[1]), int(sys.argv[2]))
