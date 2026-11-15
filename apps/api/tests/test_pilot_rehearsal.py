import os
import socket
import threading
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
import uvicorn
from db_support import ApiAs, api_settings
from fixture_support import fixture_path
from storage_support import with_store
from upload_support import Lab, run_worker
from workspace_support import owner

from parfocal_api import bulk_import
from parfocal_api.app import create_app
from parfocal_api.principals import MemberPrincipal
from parfocal_api.settings import ApiSettings
from parfocal_common.object_store import ObjectStore

pytestmark = [
    pytest.mark.db,
    pytest.mark.usefixtures("storage"),
    pytest.mark.skipif(
        os.environ.get("PARFOCAL_PILOT_REHEARSAL") != "1",
        reason="Set PARFOCAL_PILOT_REHEARSAL=1 to rehearse the pilot import with public slides",
    ),
]

REGIONS = (
    Path(__file__).resolve().parents[3] / "workers/ingest/tests/fixtures/results/regions.geojson"
)
SAMPLE = {
    "S26-0901/S26-0901_A1_HE.svs": "CMU-1-Small-Region.svs",
    "S26-0901/S26-0901_A1_HE.geojson": None,
    "S26-0902_B1_HE.svs": "CMU-1.svs",
    "S26-0902_B1_HE.geojson": None,
    "S26-0903/S26-0903_C1_HE.ndpi": "CMU-1.ndpi",
    "S26-0903/S26-0903_C1_HE.geojson": None,
    "S26-0903/S26-0903_C2_HE.tif": "Huron-1-40x.tif",
}
PRODUCTION_LIMITS = ("upload_max_bytes", "upload_part_bytes", "upload_list_page_size")


def sample_folder(root: Path) -> Path:
    folder = root / "pilot-sample"
    for name, source in SAMPLE.items():
        target = folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(REGIONS if source is None else fixture_path(source))
    return folder


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture
def served(database: str) -> Iterator[str]:
    limits = {name: ApiSettings.model_fields[name].default for name in PRODUCTION_LIMITS}
    settings = api_settings(database).model_copy(update=limits)
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(settings), port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.1)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join()


def service_token(api: ApiAs, database: str, lab: Lab) -> str:
    owner(
        database, f"UPDATE memberships SET admin_rights = true WHERE user_id = '{lab.lead.user_id}'"
    )
    admin = MemberPrincipal(lab.lead.subject, lab.tenant_id, lab.lead.user_id, lab.lead.role, True)
    created = api(admin).post(
        "/api/tenant/service-accounts",
        json={"name": "Pilot import", "scopes": ["see-slides", "create-cases", "upload-slides"]},
    )
    assert created.status_code == 201, created.text
    return str(created.json()["token"]["token"])


def worker_loop(database: str, tenant_id: uuid.UUID, work: Path, stop: threading.Event) -> None:
    while not stop.is_set():
        run_worker(database, tenant_id, work)
        time.sleep(0.5)


def remove_objects(tenant_id: uuid.UUID) -> None:
    async def go(store: ObjectStore) -> None:
        for key in await store.list_keys(f"t/{tenant_id}/"):
            await store.delete_object(key)

    with_store(go)


def test_the_pilot_sample_imports_through_the_command_with_a_service_token(
    api: ApiAs,
    database: str,
    lab: Lab,
    served: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    folder = sample_folder(tmp_path)
    monkeypatch.setenv("PARFOCAL_API_TOKEN", service_token(api, database, lab))
    base = [str(folder), "--project", str(lab.project), "--api", served, "--cases-from-names"]
    stop = threading.Event()
    worker = threading.Thread(
        target=worker_loop, args=(database, lab.tenant_id, tmp_path / "work", stop)
    )
    try:
        assert bulk_import.main([*base, "--dry-run"]) == 0
        assert "3 new cases, 0 existing, 0 files sent, 0 failed" in capsys.readouterr().out
        assert owner(
            database, f"SELECT count(*) FROM cases WHERE project_id = '{lab.project}'"
        ) == [(0,)]
        worker.start()
        started = time.monotonic()
        assert bulk_import.main([*base, "--wait", "900", "--import-as-is"]) == 0
        took = time.monotonic() - started
        assert "3 new cases, 0 existing, 7 files sent, 0 failed" in capsys.readouterr().out
        with capsys.disabled():
            print(f"\nimport and processing took {took:.1f} s")
        assert bulk_import.main([*base, "--wait", "60"]) == 0
        assert "0 new cases, 3 existing, 0 files sent, 0 failed" in capsys.readouterr().out
    finally:
        stop.set()
        if worker.is_alive():
            worker.join()
        remove_objects(lab.tenant_id)
    placed = owner(
        database,
        "SELECT c.label, count(DISTINCT s.id), count(r.id) FROM cases c "
        "LEFT JOIN slides s ON s.case_id = c.id AND s.published_at IS NOT NULL "
        "LEFT JOIN result_sets r ON r.slide_id = s.id AND r.deleted_at IS NULL "
        f"WHERE c.project_id = '{lab.project}' GROUP BY c.label ORDER BY c.label",
    )
    assert placed == [("S26-0901", 1, 1), ("S26-0902", 1, 1), ("S26-0903", 2, 1)]
    assert owner(
        database,
        f"SELECT count(*) FROM cases WHERE project_id = '{lab.project}' "
        "AND created_by_user_id IS NULL AND source = 'upload'",
    ) == [(3,)]
