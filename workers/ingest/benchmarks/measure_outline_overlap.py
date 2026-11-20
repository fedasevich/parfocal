import hashlib
import json
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import shape

root = Path(sys.argv[1])
MAX_CSS_PER_SLIDE = 16 / 2
FIT_SHARE = 2


def iou(a, b):
    union = a.union(b).area
    return a.intersection(b).area / union if union else 1.0


def shapes(kind):
    found = []
    seen = set()
    name = "cells.geojson" if kind == "cell" else "regions.parfocal.json"
    for folder in sorted(root.iterdir()):
        path = folder / name
        if not path.exists():
            continue
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        data = json.loads(raw)
        if kind == "cell":
            items = [feature["geometry"] for feature in data["features"]]
        else:
            items = [item["geometry"] for item in data["objects"] if item["kind"] == "region"]
        found += [p for p in map(shape, items) if p.is_valid and p.area > 0]
    return found


def pct(values, q):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def line(name, values):
    print(
        f"  {name}: p01={pct(values, 0.01):.3f} p05={pct(values, 0.05):.3f} "
        f"median={pct(values, 0.5):.3f} p95={pct(values, 0.95):.3f} p99={pct(values, 0.99):.3f}"
    )


def scale_of(polygon, stage):
    left, top, right, bottom = polygon.bounds
    side = max(right - left, bottom - top, 1) * FIT_SHARE
    return min(MAX_CSS_PER_SLIDE, stage / side)


for stage in (400, 600, 900):
    print("stage", stage)
    for kind in ("region", "cell"):
        polygons = shapes(kind)
        if kind == "cell":
            polygons = polygons[::5]
        print(" ", kind, len(polygons))
        for css in (1.5, 6.0):
            close = []
            for p in polygons:
                d = css / scale_of(p, stage)
                close.append(
                    min(
                        iou(p, p.buffer(d, join_style="mitre")),
                        iou(p, p.buffer(-d, join_style="mitre")),
                        iou(p, affinity.translate(p, d, 0)),
                    )
                )
            line(f"worst of grow, shrink, shift {css} css px", close)
        far = [iou(p, affinity.translate(p, (p.bounds[2] - p.bounds[0]) / 2, 0)) for p in polygons]
        line("shift by half its width", far)
        half = [iou(p, affinity.scale(p, 0.5**0.5, 0.5**0.5)) for p in polygons]
        line("half the area", half)
