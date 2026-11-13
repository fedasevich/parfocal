import csv
import io
import itertools
import json
import uuid
import zipfile
from typing import Any

import numpy as np
import shapely
import tifffile
from fixture_support import fixture_path
from PIL import Image
from shapely.geometry import shape as shape_of

from parfocal_api.training_exports import ManifestClass, ManifestTask
from parfocal_ingest.patch_export import INDEX_COLUMNS, PatchManifest, PatchWriter, source_of
from parfocal_ingest.pyramid import main_series

SLIDE = "synthetic-big-endian.tiff"
LEVEL = 1
TILE = 200
TASK = ManifestTask(id=uuid.UUID(int=1), code="T-1")
CLASSES = [
    ManifestClass(id=uuid.UUID(int=10 + key), key=key, name=f"class {key}", colour="#112233")
    for key in (1, 2, 3, 4)
]


def feature(kind: str, key: int | None, rings: list[list[tuple[int, int]]]) -> dict[str, Any]:
    return {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[x, y] for x, y in ring + ring[:1]] for ring in rings],
        },
        "properties": {"parfocal": {"kind": kind, "class_key": key}},
    }


FEATURES = [
    feature("roi", 4, [[(0, 0), (1024, 0), (1024, 768), (0, 768)]]),
    feature("cell", 3, [[(450, 400), (482, 400), (482, 431), (450, 431)]]),
    feature(
        "region",
        1,
        [
            [(100, 100), (700, 150), (600, 600), (150, 500)],
            [(300, 250), (400, 250), (400, 350), (300, 350)],
        ],
    ),
    feature("region", 2, [[(500, 450), (780, 470), (760, 740), (520, 700)]]),
    feature("region", None, [[(20, 650), (90, 650), (90, 740), (20, 740)]]),
]


def exported(tmp_path: Any, level: int = LEVEL) -> tuple[zipfile.ZipFile, uuid.UUID]:
    slide_id = uuid.UUID(int=7)
    geojson = json.dumps({"type": "FeatureCollection", "features": FEATURES}).encode()
    source = source_of(slide_id, fixture_path(SLIDE), geojson)
    assert source is not None
    target = io.BytesIO()
    writer = PatchWriter(target, level, TILE)
    writer.add(source)
    writer.finish(TASK, CLASSES)
    return zipfile.ZipFile(target), slide_id


def expected_mask(
    features: list[dict[str, Any]], x: int, y: int, width: int, height: int, downsample: int
) -> tuple[np.ndarray, np.ndarray]:
    columns, rows = np.meshgrid(np.arange(width), np.arange(height))
    level0_x = (x + columns + 0.5) * downsample
    level0_y = (y + rows + 0.5) * downsample
    keyed = [
        (item["properties"]["parfocal"], item["geometry"]["coordinates"])
        for item in features
        if item["properties"]["parfocal"]["kind"] in ("region", "cell")
        and item["properties"]["parfocal"]["class_key"] is not None
    ]
    keyed.sort(key=lambda pair: (("region", "cell").index(pair[0]["kind"]), -area_of(pair[1])))
    mask = np.zeros((height, width), dtype=np.uint8)
    for parfocal, rings in keyed:
        mask[even_odd(rings, level0_x, level0_y)] = parfocal["class_key"]
    edges = shapely.union_all([shape_of(item["geometry"]).boundary for item in features])
    near = np.asarray(shapely.distance(shapely.points(level0_x, level0_y), edges) < 0.01)
    return mask, near


def area_of(rings: list[list[list[float]]]) -> float:
    def signed(ring: list[list[float]]) -> float:
        points = np.asarray(ring, dtype=np.float64)
        x, y = points[:, 0], points[:, 1]
        return float(np.dot(x[:-1], y[1:]) - np.dot(x[1:], y[:-1])) / 2

    outer, *holes = rings
    return abs(signed(outer)) - sum(abs(signed(hole)) for hole in holes)


def even_odd(rings: list[list[list[float]]], x: np.ndarray, y: np.ndarray) -> np.ndarray:
    inside = np.zeros(x.shape, dtype=bool)
    for ring in rings:
        points = np.asarray(ring, dtype=np.float64)
        for (x1, y1), (x2, y2) in itertools.pairwise(points):
            if y1 == y2:
                continue
            crosses = (y1 > y) != (y2 > y)
            at = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            inside ^= crosses & (x < at)
    return inside


def test_every_mask_matches_the_geojson_it_came_from(tmp_path: Any) -> None:
    archive, slide_id = exported(tmp_path)
    manifest = PatchManifest.model_validate_json(archive.read("manifest.json"))
    assert manifest.skipped == []
    assert manifest.tiles == 6
    assert manifest.slides[0].unclassed_left_out == 1
    assert manifest.slides[0].downsample == 2
    features = json.loads(archive.read(manifest.slides[0].geojson))["features"]
    with tifffile.TiffFile(fixture_path(SLIDE)) as tiff:
        series = main_series(tiff)
        assert series is not None
        stored = series.levels[LEVEL].asarray()
    rows = list(csv.DictReader(io.StringIO(archive.read("index.csv").decode())))
    assert tuple(rows[0].keys()) == INDEX_COLUMNS
    assert len(rows) == manifest.tiles
    seen: set[int] = set()
    empty = 0
    compared = 0
    for row in rows:
        assert row["slide_id"] == str(slide_id)
        downsample = int(row["downsample"])
        x, y = int(row["x"]) // downsample, int(row["y"]) // downsample
        width, height = int(row["width"]), int(row["height"])
        mask = np.asarray(Image.open(io.BytesIO(archive.read(row["mask"]))))
        tile = np.asarray(Image.open(io.BytesIO(archive.read(row["tile"]))).convert("RGB"))
        assert mask.shape == (height, width)
        assert np.array_equal(tile, stored[y : y + height, x : x + width, :3])
        expected, near = expected_mask(features, x, y, width, height, downsample)
        assert np.array_equal(mask[~near], expected[~near])
        compared += int((~near).sum())
        present = sorted(int(key) for key in np.unique(mask) if key)
        assert row["classes"] == ";".join(str(key) for key in present)
        seen.update(present)
        empty += not present
    assert seen == {1, 2, 3}
    assert empty >= 1
    assert compared > 0.9 * 512 * 384


def test_a_slide_without_the_chosen_level_is_skipped(tmp_path: Any) -> None:
    archive, slide_id = exported(tmp_path, level=9)
    manifest = PatchManifest.model_validate_json(archive.read("manifest.json"))
    assert manifest.tiles == 0
    assert [(item.slide_id, item.reason) for item in manifest.skipped] == [
        (slide_id, "level-missing")
    ]
