from pathlib import Path

import pytest
from shapely.geometry import MultiPolygon, Point, Polygon

from parfocal_ingest.results import (
    ColumnMapping,
    ObjectKind,
    ResultObject,
    guess_mapping,
    header_of,
    load_raster,
    read_class_mask,
    read_geojson,
    read_heatmap,
    read_instance_mask,
    read_parfocal_json,
    read_table,
)

RESULTS = Path(__file__).resolve().parent / "fixtures" / "results"


def fixture(name: str) -> bytes:
    return (RESULTS / name).read_bytes()


def test_a_real_qupath_export_reads_into_cells_with_nuclei_and_one_region() -> None:
    result = read_geojson(fixture("qupath-0.7-cells.geojson"))
    assert result.problems == []
    cells = [item for item in result.objects if item.kind is ObjectKind.CELL]
    regions = [item for item in result.objects if item.kind is ObjectKind.REGION]
    assert (len(cells), len(regions)) == (81, 1)
    assert {cell.class_name for cell in cells} == {"Tumor", "Immune cells"}
    assert all(isinstance(cell.geometry, Polygon) and cell.nucleus is not None for cell in cells)
    assert all(
        cell.nucleus is not None and cell.geometry.contains(cell.nucleus.centroid) for cell in cells
    )
    assert regions[0].class_name == "Tumor"
    assert regions[0].geometry.bounds == (900.0, 1300.0, 1120.0, 1520.0)
    assert all(regions[0].geometry.buffer(20).contains(cell.geometry.centroid) for cell in cells)
    first = cells[0]
    assert first.source_id is not None
    assert "Nucleus: Area" in first.properties


def test_generic_geojson_keeps_classes_scores_and_names_each_problem() -> None:
    result = read_geojson(fixture("regions.geojson"))
    by_id = {item.source_id: item for item in result.objects}
    tumor = by_id["tumor-1"]
    assert (tumor.kind, tumor.class_name, tumor.score) == (ObjectKind.REGION, "Tumor", 0.91)
    assert tumor.probabilities == {"Tumor": 0.91, "Stroma": 0.09}
    assert by_id["zone-1"].kind is ObjectKind.ZONE
    bowtie = by_id["bowtie"].geometry
    assert bowtie.is_valid
    assert isinstance(bowtie, MultiPolygon)
    point = next(item for item in result.objects if isinstance(item.geometry, Point))
    assert (point.kind, point.class_name, point.properties) == (
        ObjectKind.CELL,
        "Lymphocyte",
        {"Area": 31.5},
    )
    assert [(p.where, p.message) for p in result.problems] == [
        ("feature 4", "Tiles are not results"),
        ("feature 5", "LineString geometry is not supported"),
        ("feature 6", "The feature has no geometry"),
    ]


@pytest.mark.parametrize(
    "data",
    [
        b"not json",
        b'{"type": "Topology"}',
        b'{"type": "Feature", "geometry": 5}',
    ],
)
def test_files_that_are_not_geojson_are_refused_whole(data: bytes) -> None:
    result = read_geojson(data)
    assert result.objects == []
    assert [problem.where for problem in result.problems] in (["file"], ["feature 1"])


def test_a_csv_with_renamed_columns_reads_through_a_mapping() -> None:
    data = fixture("cells-renamed.csv")
    header = header_of(data)
    assert header == [
        "Cell ID",
        "Centroid X px",
        "Centroid Y px",
        "Cell type",
        "Confidence",
        "Area",
    ]
    guessed = guess_mapping(header)
    assert (guessed.x, guessed.class_name, guessed.score) == (None, None, "Confidence")
    mapping = ColumnMapping(
        x="Centroid X px",
        y="Centroid Y px",
        class_name="Cell type",
        score="Confidence",
        source_id="Cell ID",
    )
    result = read_table(data, mapping)
    assert [(o.source_id, o.geometry.coords[0], o.class_name, o.score) for o in result.objects] == [
        ("c-1", (100.5, 200.25), "Tumor", 0.93),
        ("c-2", (110.0, 210.0), "Lymphocyte", 0.71),
        ("c-4", (130.0, 230.0), None, None),
    ]
    assert result.objects[0].properties == {"Area": "40"}
    assert [(p.where, p.message) for p in result.problems] == [("row 4", "x and y must be numbers")]
    assert read_table(data, ColumnMapping()).problems[0].where == "file"


def test_a_tsv_is_sniffed_and_its_columns_are_guessed() -> None:
    data = fixture("cells.tsv")
    mapping = guess_mapping(header_of(data))
    assert mapping == ColumnMapping(x="x", y="y", class_name="class", score="score")
    result = read_table(data, mapping)
    assert [(o.kind, o.class_name, o.score) for o in result.objects] == [
        (ObjectKind.CELL, "Tumor", 0.8),
        (ObjectKind.CELL, "Stroma", 0.6),
    ]


def outlines(objects: list[ResultObject]) -> list[tuple[float, ...]]:
    return [tuple(round(v, 1) for v in item.geometry.bounds) for item in objects]


def test_an_instance_mask_keeps_touching_objects_apart_at_level_scale() -> None:
    labels = load_raster(fixture("instance-mask.png"), "instance-mask.png")
    result = read_instance_mask(labels, downsample=4)
    assert [item.source_id for item in result.objects] == ["1", "2", "3"]
    assert outlines(result.objects) == [
        (42.0, 42.0, 78.0, 78.0),
        (82.0, 42.0, 118.0, 78.0),
        (162.0, 162.0, 222.0, 198.0),
    ]
    assert not result.objects[0].geometry.intersects(result.objects[1].geometry)


def test_a_class_mask_becomes_one_region_per_connected_part() -> None:
    classes = load_raster(fixture("class-mask.png"), "class-mask.png")
    result = read_class_mask(classes, {1: "Tumor", 2: "Stroma"}, downsample=1)
    assert [(item.kind, item.class_name) for item in result.objects] == [
        (ObjectKind.REGION, "Tumor"),
        (ObjectKind.REGION, "Tumor"),
        (ObjectKind.REGION, "Stroma"),
        (ObjectKind.REGION, "7"),
    ]
    assert [(p.where, p.message) for p in result.problems] == [
        ("value 7", "The mask value has no class name")
    ]


def test_a_heatmap_stays_a_raster_aligned_to_its_level() -> None:
    values = load_raster(fixture("heatmap-level2.tif"), "heatmap-level2.tif")
    result = read_heatmap(values, level=2, downsample=4, class_name="Tumor")
    assert result.objects == []
    (heatmap,) = result.heatmaps
    assert (heatmap.values.shape, heatmap.level, heatmap.downsample) == ((32, 32), 2, 4)
    assert float(heatmap.values.max()) == 1.0
    colour = read_heatmap(values[..., None].repeat(3, axis=2), level=2, downsample=4)
    assert colour.problems[0].message == "A heatmap is a single-channel image"


def test_the_parfocal_template_reads_into_the_same_object_form() -> None:
    template = Path(__file__).resolve().parents[3] / "docs" / "reference"
    data = (template / "parfocal-results-v1.template.json").read_bytes()
    result = read_parfocal_json(data)
    assert result.problems == []
    assert [(o.kind, o.class_name, o.source_id) for o in result.objects] == [
        (ObjectKind.REGION, "Tumor", "region-1"),
        (ObjectKind.CELL, "Tumor", "cell-1"),
        (ObjectKind.CELL, "Lymphocyte", "cell-2"),
    ]
    assert result.objects[1].parent == "region-1"
    assert result.objects[2].properties == {"area_um2": 31.5}
    assert read_parfocal_json(b'{"format": "geojson", "version": 1, "objects": []}').problems
