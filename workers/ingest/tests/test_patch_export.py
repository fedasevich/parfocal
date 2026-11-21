import csv
import hashlib
import io
import itertools
import json
import uuid
import zipfile
from datetime import UTC, datetime
from typing import Any

import numpy as np
import pytest
import shapely
import tifffile
from fixture_support import fixture_path
from PIL import Image
from pycocotools.coco import COCO
from shapely.geometry import shape as shape_of

from parfocal_api.check_options import check_of
from parfocal_api.training_exports import (
    Manifest,
    ManifestClass,
    ManifestTask,
    applied_filters,
    zipped,
)
from parfocal_common.jobs import StepFailedError
from parfocal_ingest.patch_export import (
    INDEX_COLUMNS,
    PatchManifest,
    PatchWriter,
    source_dataset,
    source_of,
)
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


class FrozenStore:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = objects

    async def get_object(self, key: str) -> bytes:
        return self.objects[key]


class FrozenStep:
    def __init__(self, values: dict[str, Any]) -> None:
        self.input = values


def frozen_version() -> tuple[bytes, dict[str, bytes]]:
    options = check_of(None)
    manifest = Manifest(
        format="parfocal-training-dataset",
        version=2,
        created_at=datetime.now(UTC),
        task=TASK,
        coordinates="level-0-pixels",
        kinds=[],
        origins=[],
        classes=CLASSES,
        check_options=options,
        annotators=[],
        slides=[],
        unchecked_left_out=0,
        filters=applied_filters(None, options),
        dataset_version=3,
    )
    files = {"slides/one.geojson": b'{"type":"FeatureCollection","features":[]}'}
    return zipped(manifest, files), files


async def test_patches_of_a_frozen_version_read_its_stored_files_and_name_it() -> None:
    content, files = frozen_version()
    step = FrozenStep(
        {"dataset_key": "frozen.zip", "dataset_sha256": hashlib.sha256(content).hexdigest()}
    )
    store = FrozenStore({"frozen.zip": content})
    made, read = await source_dataset(step, None, None, store)  # type: ignore[arg-type]
    assert read == files
    assert made.dataset_version == 3
    buffer = io.BytesIO()
    finished = PatchWriter(buffer, LEVEL, TILE).finish(
        made.task, made.classes, made.dataset_version
    )
    assert finished.dataset_version == 3


async def test_a_frozen_version_that_changed_is_refused() -> None:
    content, _ = frozen_version()
    step = FrozenStep({"dataset_key": "frozen.zip", "dataset_sha256": "0" * 64})
    store = FrozenStore({"frozen.zip": content})
    with pytest.raises(StepFailedError, match="dataset-version-changed"):
        await source_dataset(step, None, None, store)  # type: ignore[arg-type]


def feature_with_identity(
    kind: str, key: int | None, rings: list[list[tuple[int, int]]], name: str, origin: str
) -> dict[str, Any]:
    item = feature(kind, key, rings)
    item["properties"]["parfocal"].update({"id": name, "origin": origin})
    return item


IDENTIFIED = [
    feature_with_identity(
        "region",
        1,
        [
            [(100, 100), (700, 150), (600, 600), (150, 500)],
            [(300, 250), (400, 250), (400, 350), (300, 350)],
        ],
        "R-one",
        "human",
    ),
    feature_with_identity(
        "region", 2, [[(500, 450), (780, 470), (760, 740), (520, 700)]], "R-two", "ai"
    ),
    feature_with_identity(
        "cell", 3, [[(450, 400), (482, 400), (482, 431), (450, 431)]], "C-one", "human"
    ),
]


def coco_exported() -> zipfile.ZipFile:
    geojson = json.dumps({"type": "FeatureCollection", "features": IDENTIFIED}).encode()
    source = source_of(uuid.UUID(int=7), fixture_path(SLIDE), geojson)
    assert source is not None
    target = io.BytesIO()
    writer = PatchWriter(target, LEVEL, TILE, coco=True)
    writer.add(source)
    manifest = writer.finish(TASK, CLASSES, 2)
    assert manifest.annotations == "annotations.json"
    return zipfile.ZipFile(target)


def test_the_coco_file_loads_and_its_areas_match_the_masks() -> None:
    archive = coco_exported()
    document = json.loads(archive.read("annotations.json"))
    assert [item["id"] for item in document["categories"]] == [1, 2, 3, 4]
    assert document["info"]["dataset_version"] == 2
    index = COCO()
    index.dataset = document
    index.createIndex()
    assert len(document["images"]) == 6
    names = {item["file_name"] for item in document["images"]}
    assert names <= set(archive.namelist())
    identities = {item["parfocal_id"]: item["origin"] for item in document["annotations"]}
    assert identities == {"R-one": "human", "R-two": "ai", "C-one": "human"}
    by_object: dict[str, float] = {}
    for item in document["annotations"]:
        image = index.imgs[item["image_id"]]
        painted = index.annToMask(item)
        assert painted.shape == (image["height"], image["width"])
        assert abs(int(painted.sum()) - item["area"]) <= 0.02 * item["area"] + 4
        assert item["bbox"][0] >= 0
        assert item["bbox"][0] + item["bbox"][2] <= image["width"] + 0.01
        assert item["bbox"][1] + item["bbox"][3] <= image["height"] + 0.01
        by_object[item["parfocal_id"]] = by_object.get(item["parfocal_id"], 0) + item["area"]
    painted_totals = {"R-two": 0, "C-one": 0}
    for image in document["images"]:
        name = image["file_name"].replace("tiles/", "masks/")
        mask = np.asarray(Image.open(io.BytesIO(archive.read(name))))
        painted_totals["C-one"] += int((mask == 3).sum())
        painted_totals["R-two"] += int((mask == 2).sum())
    for name, total in painted_totals.items():
        assert abs(total - by_object[name]) <= 0.05 * by_object[name]
    expected_one = shape_of(IDENTIFIED[0]["geometry"]).area / 4
    assert abs(by_object["R-one"] - expected_one) <= 0.01 * expected_one


def test_a_patch_export_without_coco_has_no_annotation_file(tmp_path: Any) -> None:
    archive, _ = exported(tmp_path)
    assert "annotations.json" not in archive.namelist()
    manifest = PatchManifest.model_validate_json(archive.read("manifest.json"))
    assert manifest.annotations is None
