# /// script
# requires-python = ">=3.11"
# dependencies = ["openslide-python", "openslide-bin", "pillow"]
# ///
import argparse
import json
from pathlib import Path

import openslide
from PIL import Image, ImageDraw

RESULTS = Path(__file__).resolve().parents[1] / "packages/test-fixtures/model-results/cmu-1-ndpi"
TUMOR = (248, 113, 113)
CENTER = (31232, 4866)
SPAN = (2800, 2100)
LEVEL_DOWNSAMPLE = 1
WIDTH = 1600


def inside(points, box):
    return any(box[0] <= x <= box[2] and box[1] <= y <= box[3] for x, y in points)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("slide")
    parser.add_argument("out")
    parser.add_argument("--quality", type=int, default=60)
    parser.add_argument("--width", type=int, default=WIDTH)
    args = parser.parse_args()

    left = CENTER[0] - SPAN[0] // 2
    top = CENTER[1] - SPAN[1] // 2
    box = (left, top, left + SPAN[0], top + SPAN[1])
    slide = openslide.OpenSlide(args.slide)
    level = min(
        range(slide.level_count), key=lambda i: abs(slide.level_downsamples[i] - LEVEL_DOWNSAMPLE)
    )
    size = (
        round(SPAN[0] / slide.level_downsamples[level]),
        round(SPAN[1] / slide.level_downsamples[level]),
    )
    base = slide.read_region((left, top), level, size).convert("RGB")
    width = args.width
    height = round(width * SPAN[1] / SPAN[0])
    image = base.resize((width, height), Image.LANCZOS).convert("RGBA")
    scale = width / SPAN[0]

    def project(ring):
        return [((x - left) * scale, (y - top) * scale) for x, y in ring]

    fill = Image.new("RGBA", image.size, (0, 0, 0, 0))
    fill_draw = ImageDraw.Draw(fill)
    line = Image.new("RGBA", image.size, (0, 0, 0, 0))
    line_draw = ImageDraw.Draw(line)

    cells = json.loads((RESULTS / "cells.geojson").read_text())["features"]
    for feature in cells:
        ring = feature["geometry"]["coordinates"][0]
        if inside(ring, box):
            fill_draw.polygon(project(ring), fill=(*TUMOR, 70))
            line_draw.line(
                [*project(ring), project(ring)[0]],
                fill=(*TUMOR, 230),
                width=max(1, round(3 * width / WIDTH)),
            )

    regions = json.loads((RESULTS / "regions.parfocal.json").read_text())["objects"]
    for region in regions:
        ring = region["geometry"]["coordinates"][0]
        if inside(ring, box):
            points = project(ring)
            fill_draw.polygon(points, fill=(*TUMOR, 40))
            line_draw.line([*points, points[0]], fill=(*TUMOR, 255), width=5, joint="curve")

    image = Image.alpha_composite(Image.alpha_composite(image, fill), line).convert("RGB")
    image.save(args.out, "WEBP", quality=args.quality, method=6)


if __name__ == "__main__":
    main()
