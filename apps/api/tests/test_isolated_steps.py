import uuid
from pathlib import Path
from typing import Any

import openslide
import pytest
import tifffile
from db_support import ApiAs
from fixture_support import fixture_path
from test_import_checks import HEATMAP, sized_slide, upload
from test_slide_ingest import PUBLIC_FILES
from upload_support import Lab, keys_under, run_worker, send_file, start_upload, status_of

from parfocal_common.ingest import slide_prefix
from parfocal_ingest import import_checks, result_import, results

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def refuse_to_read(*_arguments: Any, **_keywords: Any) -> None:
    raise AssertionError("a slide reader ran inside the worker")


@pytest.fixture
def readers_blocked_in_the_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(openslide.OpenSlide, "__init__", refuse_to_read)
    monkeypatch.setattr(tifffile.TiffFile, "__init__", refuse_to_read)


@pytest.fixture
def result_readers_blocked_in_the_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    for module in (import_checks, result_import, results):
        for name in ("read_checked", "heatmap_values", "load_raster", "stream_geojson"):
            if hasattr(module, name):
                monkeypatch.setattr(module, name, refuse_to_read)
    monkeypatch.setattr(tifffile.TiffFile, "__init__", refuse_to_read)


@pytest.mark.usefixtures("result_readers_blocked_in_the_worker")
def test_result_files_are_parsed_only_in_the_parse_process(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = sized_slide(database, lab)
    data = b"x,y,class,score\n100,100,Tumor,0.9\n200,200,Tumor,0.8\n"
    started = upload(api, lab, "clean.csv", data, slide_id=str(slide_id))
    run_worker(database, lab.tenant_id, tmp_path)
    assert status_of(api, lab.lead, started)["status"] == "ready"
    heatmap_slide = sized_slide(database, lab, width=128, height=128)
    heat = upload(api, lab, "heat.tif", HEATMAP, slide_id=str(heatmap_slide))
    run_worker(database, lab.tenant_id, tmp_path)
    assert status_of(api, lab.lead, heat)["status"] == "waiting"


@pytest.mark.usefixtures("readers_blocked_in_the_worker")
def test_index_and_derive_read_the_slide_only_in_the_parse_process(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    data = fixture_path("CMU-1-Small-Region.svs").read_bytes()
    upload = start_upload(api, lab.lead, lab.project, "CMU-1-Small-Region.svs", len(data))
    send_file(api, lab.lead, upload, data)
    run_worker(database, lab.tenant_id, tmp_path / "work")
    found = status_of(api, lab.lead, upload)
    assert found["status"] == "ready"
    prefix = slide_prefix(lab.tenant_id, uuid.UUID(found["slide_id"]))
    assert keys_under(prefix) >= PUBLIC_FILES
