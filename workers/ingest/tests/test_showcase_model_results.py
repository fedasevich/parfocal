import json
from pathlib import Path

import pytest

from parfocal_ingest.results import ObjectKind, read_geojson, read_parfocal_json

MODEL_RESULTS = Path(__file__).resolve().parents[3] / "packages/test-fixtures/model-results"
FOLDERS = sorted(path for path in MODEL_RESULTS.iterdir() if path.is_dir())


@pytest.mark.parametrize("folder", FOLDERS, ids=lambda path: path.name)
def test_the_seeded_cells_import_with_no_problems(folder: Path) -> None:
    run = json.loads((folder / "run.json").read_text())
    read = read_geojson((folder / "cells.geojson").read_bytes())
    assert read.problems == []
    assert len(read.objects) == run["cells"]["count"]
    assert {found.kind for found in read.objects} == {ObjectKind.CELL}


@pytest.mark.parametrize(
    "folder",
    [folder for folder in FOLDERS if (folder / "regions.parfocal.json").is_file()],
    ids=lambda path: path.name,
)
def test_the_seeded_regions_import_with_no_problems(folder: Path) -> None:
    run = json.loads((folder / "run.json").read_text())
    read = read_parfocal_json((folder / "regions.parfocal.json").read_bytes())
    assert read.problems == []
    assert len(read.objects) == run["tumor_map"]["regions"]
    assert {found.kind for found in read.objects} == {ObjectKind.REGION}
