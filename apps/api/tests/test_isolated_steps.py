import uuid
from pathlib import Path
from typing import Any

import openslide
import pytest
import tifffile
import wsidicom
from db_support import ApiAs
from fixture_support import fixture_path
from test_slide_ingest import PUBLIC_FILES
from upload_support import Lab, keys_under, run_worker, send_file, start_upload, status_of

from parfocal_common.ingest import slide_prefix

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def refuse_to_read(*_arguments: Any, **_keywords: Any) -> None:
    raise AssertionError("a slide reader ran inside the worker")


@pytest.fixture
def readers_blocked_in_the_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(openslide.OpenSlide, "__init__", refuse_to_read)
    monkeypatch.setattr(tifffile.TiffFile, "__init__", refuse_to_read)
    monkeypatch.setattr(wsidicom.WsiDicom, "open", refuse_to_read)


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
