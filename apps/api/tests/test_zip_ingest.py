import gzip
import json
import zipfile
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

import pytest
from db_support import ApiAs, api_settings
from fastapi.testclient import TestClient
from fixture_support import fixture_path
from storage_support import with_store
from test_large_result_imports import remove_tenant_objects
from upload_support import Lab, exists, keys_under, run_worker, send_file, single, start_upload
from upload_support import status_of as upload_state
from workspace_support import owner

from parfocal_api.app import create_app
from parfocal_common.ingest import REASONS, Refusal, restricted_ranges_key
from parfocal_common.jobs import StepFailedError
from parfocal_ingest import workflow
from parfocal_ingest.parse_jobs import identify_file, unpacked_in
from parfocal_ingest.pyramid import Pyramid, read_pyramid
from parfocal_ingest.pyramid_tiff import CONVERTED_VARIANT

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

GIB = 1024 * 1024 * 1024
PART_BYTES = 64 * 1024 * 1024
BIGTIFF = b"II+\x00"
MIRAX = "CMU-1-Saved-1_16.zip"
DICOM = "CMU-1-JP2K-33005-v2.zip"
DERIVED = {
    "levels.json",
    "tile-index.json",
    "thumbnail.jpg",
    "overview.jpg",
    "tissue.png",
    "tissue.json",
}


@contextmanager
def zip_upload_api(database: str) -> Generator[ApiAs]:
    settings = api_settings(database).model_copy(
        update={"upload_max_bytes": 4 * GIB, "upload_part_bytes": PART_BYTES}
    )
    app = create_app(settings)
    with TestClient(app) as client:
        yield ApiAs(app, client)


def source_pyramid(path: Path, folder: Path) -> Pyramid:
    identified = identify_file(path, path.name)
    found = read_pyramid(unpacked_in(folder, path, identified), identified)
    assert isinstance(found, Pyramid), found
    return found


@pytest.mark.parametrize(("name", "format_id"), [(MIRAX, "mirax"), (DICOM, "dicom")])
def test_an_uploaded_mirax_or_dicom_zip_is_published_as_a_pyramid_tiff(
    database: str, lab: Lab, tmp_path: Path, name: str, format_id: str
) -> None:
    path = fixture_path(name)
    source = source_pyramid(path, tmp_path / "source")
    data = path.read_bytes()
    try:
        with zip_upload_api(database) as api:
            upload = start_upload(api, lab.lead, lab.project, name, len(data))
            send_file(api, lab.lead, upload, data)
            del data
            run_worker(database, lab.tenant_id, tmp_path / "work")
            state = upload_state(api, lab.lead, upload)
        assert (state["status"], state["reason"]) == ("ready", None), state
        slide_id = state["slide_id"]
        row = single(
            database,
            "SELECT label, format, variant, width, height, level_count, mpp_x, file_bytes, "
            f"original_key, restricted_images FROM slides WHERE id = '{slide_id}'",
        )
        public = f"t/{lab.tenant_id}/s/{slide_id}/"
        original = f"{public}original.tiff"
        base = source.levels[0]
        assert row[:6] == (
            name.removesuffix(".zip"),
            format_id,
            CONVERTED_VARIANT,
            base.width,
            base.height,
            len(source.levels),
        )
        assert row[6] == pytest.approx(source.scale.mpp_x, rel=1e-6)
        assert (row[8], row[9]) == (original, ["label", "macro"])
        assert row[7] == with_store(lambda store: store.head_object(original))
        assert with_store(lambda store: store.get_range(original, 0, 4)) == BIGTIFF
        stored = keys_under(public)
        assert DERIVED | {"original.tiff"} <= stored
        assert not any(key.endswith(".zip") for key in stored)
        assert keys_under(f"t/{lab.tenant_id}/quarantine/") == set()
        index = gzip.decompress(
            with_store(lambda store: store.get_stored_bytes(f"{public}tile-index.json"))
        )
        assert json.loads(index)["formatId"] == "generic-tiff"
        table = json.loads(with_store(lambda store: store.get_object(f"{public}levels.json")))
        assert [(level["width"], level["height"]) for level in table["levels"]] == [
            (level.width, level.height) for level in source.levels
        ]
        ranges = with_store(
            lambda store: store.get_object(restricted_ranges_key(lab.tenant_id, slide_id))
        )
        assert json.loads(ranges)["ranges"] == []
        assert list((tmp_path / "work").iterdir()) == []
    finally:
        remove_tenant_objects(lab.tenant_id)


def test_a_converted_slide_refused_after_conversion_leaves_no_pyramid_tiff(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def refused_index(context: object) -> dict[str, object]:
        raise StepFailedError(Refusal.UNREADABLE)

    monkeypatch.setitem(workflow.BODIES, "index", refused_index)
    data = fixture_path(MIRAX).read_bytes()
    upload = start_upload(api, lab.lead, lab.project, MIRAX, len(data))
    send_file(api, lab.lead, upload, data)
    run_worker(database, lab.tenant_id, tmp_path / "work")

    state = upload_state(api, lab.lead, upload)
    assert (state["status"], state["reason"]) == ("failed", Refusal.UNREADABLE.value)
    assert not any(key.endswith("original.tiff") for key in keys_under(f"t/{lab.tenant_id}/s/"))
    assert not exists(upload["key"])


def zeroed_data_file(source: Path, target: Path) -> None:
    with (
        zipfile.ZipFile(source) as found,
        zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as out,
    ):
        largest = max(
            (info for info in found.infolist() if info.filename.endswith("/Data0000.dat")),
            key=lambda info: info.file_size,
        )
        for info in found.infolist():
            body = found.read(info)
            out.writestr(info.filename, bytes(len(body)) if info is largest else body)


def test_a_zip_the_converter_cannot_read_fails_with_its_reason(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    broken = tmp_path / MIRAX
    zeroed_data_file(fixture_path(MIRAX), broken)
    data = broken.read_bytes()
    upload = start_upload(api, lab.lead, lab.project, MIRAX, len(data))
    send_file(api, lab.lead, upload, data)
    run_worker(database, lab.tenant_id, tmp_path / "work")

    state = upload_state(api, lab.lead, upload)
    assert (state["status"], state["reason"], state["slide_id"]) == (
        "failed",
        Refusal.UNCONVERTIBLE.value,
        None,
    )
    assert state["message"] == REASONS[Refusal.UNCONVERTIBLE]
    assert state["failure_class"] == "permanent"
    assert owner(database, f"SELECT id FROM slides WHERE project_id = '{lab.project}'") == []
    assert not exists(upload["key"])
    assert keys_under(f"t/{lab.tenant_id}/s/") == set()
