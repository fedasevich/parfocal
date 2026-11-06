import argparse
import itertools
import json
import sys
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from parfocal_ml.datasets import cache_dir, samples

MIN_NUCLEUS_AREA = 30
MISS_SIGMA = 0.35
SEED = 20261106
FIXTURE_FOLDER = "smart-select-smoke"


def fixture_dir() -> Path:
    return cache_dir() / FIXTURE_FOLDER


def realistic_click(
    inside: NDArray[np.bool_], area: int, rng: np.random.Generator
) -> tuple[int, int]:
    ys, xs = np.nonzero(inside)
    centre_x, centre_y = float(xs.mean()), float(ys.mean())
    sigma = MISS_SIGMA * float(np.sqrt(area / np.pi))
    for _ in range(200):
        x = round(centre_x + rng.normal(0.0, sigma))
        y = round(centre_y + rng.normal(0.0, sigma))
        if 0 <= y < inside.shape[0] and 0 <= x < inside.shape[1] and inside[y, x]:
            return x, y
    index = int(np.argmin((xs - centre_x) ** 2 + (ys - centre_y) ** 2))
    return int(xs[index]), int(ys[index])


def nuclei_of(
    labels: NDArray[np.int32], limit: int, rng: np.random.Generator
) -> list[dict[str, object]]:
    found = []
    for index, window in enumerate(ndimage.find_objects(labels), start=1):
        if window is None:
            continue
        inside = labels == index
        area = int(inside.sum())
        if area < MIN_NUCLEUS_AREA:
            continue
        found.append((index, window, inside, area))
    if len(found) > limit:
        picks = np.linspace(0, len(found) - 1, limit).round().astype(int)
        found = [found[int(pick)] for pick in picks]
    nuclei: list[dict[str, object]] = []
    for index, window, inside, area in found:
        x, y = realistic_click(inside, area, rng)
        nuclei.append(
            {
                "id": index,
                "area": area,
                "box": [
                    int(window[1].start),
                    int(window[0].start),
                    int(window[1].stop),
                    int(window[0].stop),
                ],
                "realistic": [x, y],
            }
        )
    return nuclei


def write(out: Path, patches: int, per_patch: int) -> dict[str, object]:
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    manifest = []
    for number, sample in enumerate(itertools.islice(samples("tnbc"), patches)):
        height, width = sample.labels.shape
        (out / f"p{number}.rgb").write_bytes(np.ascontiguousarray(sample.rgb).tobytes())
        (out / f"p{number}.labels").write_bytes(
            np.ascontiguousarray(sample.labels.astype("<i4")).tobytes()
        )
        manifest.append(
            {
                "name": sample.name,
                "width": width,
                "height": height,
                "rgb": f"p{number}.rgb",
                "labels": f"p{number}.labels",
                "nuclei": nuclei_of(sample.labels, per_patch, rng),
            }
        )
    document: dict[str, object] = {"seed": SEED, "missSigma": MISS_SIGMA, "patches": manifest}
    (out / "manifest.json").write_text(json.dumps(document))
    return document


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Write TNBC patches and nuclei for the browser smoke test"
    )
    parser.add_argument("--patches", type=int, default=8)
    parser.add_argument("--per-patch", type=int, default=10)
    parser.add_argument("--out", type=Path, default=fixture_dir())
    args = parser.parse_args()
    document = write(args.out, args.patches, args.per_patch)
    patches = document["patches"]
    assert isinstance(patches, list)
    count = sum(len(patch["nuclei"]) for patch in patches)
    print(f"wrote {len(patches)} patches and {count} nuclei to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
