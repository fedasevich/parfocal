import json
import uuid
from pathlib import Path
from typing import Any

import pytest

from parfocal_api.showcase import FORMAT_GALLERY, VIEWER_SAMPLE
from parfocal_api.showcase_results import (
    MODEL_RESULTS,
    folder_of,
    gallery_label,
    model_cells,
    model_regions,
)
from parfocal_common.chunk_store import build_cells

REAL = {
    VIEWER_SAMPLE: True,
    "CMU-1-Small-Region.svs": True,
    "JP2K-33003-1.svs": True,
    "CMU-1-JP2K-33005.svs": True,
    "CMU-1.ndpi": True,
    "Leica-1.scn": True,
    "OS-1.bif": True,
    "Philips-4.tiff": True,
    "Philips-3.tiff": False,
    "Huron-1-40x.tif": True,
    "Argos-1.avs": True,
    "CMU-1.tiff": True,
    "CMU-1-JP2K-33005-v2.zip": True,
}
UNREADABLE_BY_THE_MODELS = {"CMU-1-Saved-1_16.zip", "synthetic-zlib.ome.tiff"}


def run_of(label: str) -> dict[str, Any]:
    return json.loads((folder_of(label) / "run.json").read_text())


def test_every_result_folder_belongs_to_a_seeded_slide() -> None:
    labels = {VIEWER_SAMPLE, *(slide.file for slide in FORMAT_GALLERY)}
    folders = {path.name for path in MODEL_RESULTS.iterdir() if path.is_dir()}
    assert folders == {folder_of(label).name for label in REAL}
    assert set(REAL) | UNREADABLE_BY_THE_MODELS == labels


@pytest.mark.parametrize("label", sorted(REAL))
def test_real_cells_load_inside_their_crop_and_store_as_chunks(label: str) -> None:
    run = run_of(label)
    cells = model_cells(label)
    assert cells is not None
    reported: dict[str, Any] = run["cells"]
    assert len(cells.cells) == reported["count"] > 12
    left, top, right, bottom = (int(value) for value in reported["crop_px"])
    for cell in cells.cells:
        xs, ys = cell.ring[0::2], cell.ring[1::2]
        assert left <= min(xs)
        assert max(xs) <= right
        assert top <= min(ys)
        assert max(ys) <= bottom
        assert cell.probs is not None
        assert len(cell.probs) == len(cells.classes)
    built = build_cells(uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), cells.cells, len(cells.classes))
    assert built.entries


@pytest.mark.parametrize("label", sorted(REAL))
def test_real_regions_exist_only_where_the_tumour_model_ran(label: str) -> None:
    regions = model_regions(label)
    if not REAL[label]:
        assert regions is None
        return
    assert regions is not None
    assert regions.classes == ["Tumor"]
    run = run_of(label)
    reported: dict[str, Any] = run["tumor_map"]
    assert len(regions.rows) == reported["regions"] > 0
    width, height = (int(value) for value in run["dimensions"])
    for row in regions.rows:
        assert row.wkt.startswith("POLYGON((")
        points = row.wkt.removeprefix("POLYGON((").removesuffix("))").split(",")
        for point in points:
            x, y = (float(value) for value in point.split())
            assert 0 <= x <= width
            assert 0 <= y <= height


def test_a_slide_without_files_has_no_real_results(tmp_path: Path) -> None:
    assert model_cells("Leica-1.scn", tmp_path) is None
    assert model_regions("Leica-1.scn", tmp_path) is None


def test_zipped_gallery_slides_read_by_stem_and_format_and_keep_their_results() -> None:
    shown = {
        slide.file: gallery_label(slide.file, slide.format)
        for slide in FORMAT_GALLERY
        if slide.file.endswith(".zip")
    }
    assert shown == {
        "CMU-1-Saved-1_16.zip": "CMU-1-Saved-1_16 (MIRAX)",
        "CMU-1-JP2K-33005-v2.zip": "CMU-1-JP2K-33005-v2 (DICOM)",
    }
    for file, label in shown.items():
        assert folder_of(label) == folder_of(file)
    assert model_cells(shown["CMU-1-JP2K-33005-v2.zip"]) is not None
    assert gallery_label("CMU-1.ndpi", "hamamatsu-ndpi") == "CMU-1.ndpi"
